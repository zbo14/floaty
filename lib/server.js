'use strict'

const dgram = require('dgram')
const EventEmitter = require('events')
const Peer = require('./peer')

/**
 * @typedef   {Object}   Message
 *
 * @property  {String}   command          - the message command.
 * @property  {Number}   sender_id        - the id of the server that sent the message.
 * @property  {String}   [target_address] - the address of the target peer in a ping-req.
 * @property  {Number}   [target_id]      - the id of the target peer in a ping-req.
 * @property  {String}   [target_port]    - the port of the target peer in a ping-req.
 * @property  {Update[]} updates          - the updates piggybacked on the message.
 */

/**
 * @typedef   {Object}  Update
 *
 * @property  {String}  address  - the address of the peer being updated.
 * @property  {Number}  count    - the number of times the update has been sent.
 * @property  {Number}  id       - the id of the peer being updated.
 * @property  {Number}  port     - the port of the peer being updated.
 * @property  {Number}  sequence - the sequence number of the peer being updated.
 * @property  {String}  status   - the updated status.
 */

/**
 * The UDP server that implements the SWIM protocol.
 *
 * @extends EventEmitter
 */
class Server extends EventEmitter {
  /**
   * @param {Info} info
   */
  constructor ({ id, port, address }) {
    super()
    this.setMaxListeners(Infinity)

    this.address = address
    this.id = id
    this.port = port
  }

  /**
   * Initialize the server with peers.
   *
   * @param  {Object[]} [peers = []]
   */
  init (peers = []) {
    this.peers = []
    this.sequence = 0
    this.updates = []

    peers.forEach(peer => this.addPeer(peer))

    this.setIter()
  }

  get peersOnline () {
    return this.peers.filter(({ status }) => status !== 'faulty')
  }

  getPeer (id) {
    return this.peers.find(peer => peer.id === id)
  }

  setIter () {
    this.shufflePeers()
    this.iter = this.peersOnline[Symbol.iterator]()
  }

  /**
   * Close the UDP socket.
   */
  closeSocket () {
    this.socket.close()
  }

  /**
   * start
   */
  async start () {
    try {
      await this.runProtocolPeriod()
    } catch (err) {
      this.emit('error', err)
    } finally {
      this.timeout = setTimeout(() => this.start(), 2e3)
    }
  }

  /**
   * stop
   */
  stop () {
    clearTimeout(this.timeout)
  }

  async eventReq (id, eventName, timeout = 10e3) {
    const peer = this.getPeer(id)

    if (!peer) {
      throw new Error(`Could not find peer with id: ${id}`)
    }

    await Promise.all([
      new Promise((resolve, reject) => {
        setTimeout(() => {
          reject(new Error('Request timed out'))
        }, timeout)

        peer.once(eventName, resolve)
      }),
      peer.send({
        command: 'event-req',
        eventName
      })
    ])
  }

  /**
   * Open the UDP socket.
   *
   * @param  {dgram.Socket} [socket]
   */
  openSocket (socket) {
    let msg

    this.socket = socket || dgram.createSocket('udp4')

    this.socket.on('message', async (buf, rinfo) => {
      try {
        msg = buf.toString()
        msg = JSON.parse(msg)
      } catch (_) {
        this.emit('error', new Error(`Invalid message: "${msg}"`))
      }

      try {
        await this.handleMessage(msg, rinfo)
      } catch (err) {
        this.emit('error', err)
      }
    })

    return new Promise((resolve, reject) => {
      this.socket.bind(this.port, this.address, err => {
        err ? reject(err) : resolve()
      })
    })
  }

  // from wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle#The_modern_algorithm
  shufflePeers () {
    let temp

    for (let i = 0, j; i < this.peers.length - 1; i++) {
      j = i + Math.floor(Math.random() * (this.peers.length - i))
      temp = this.peers[i]
      this.peers[i] = this.peers[j]
      this.peers[j] = temp
    }
  }

  runProtocolPeriod () {
    const { value: peer, done } = this.iter.next()

    if (done) {
      this.setIter()
      return this.runProtocolPeriod()
    }

    return peer.ping(true)
  }

  otherRandomPeer (peer) {
    const peers = this.peersOnline

    let index
    let otherPeer

    while (!otherPeer || peer.id === otherPeer.id) {
      index = Math.floor(Math.random() * peers.length)
      otherPeer = peers[index]
    }

    return otherPeer
  }

  addPeer (info) {
    if (info.id === this.id || this.getPeer(info.id)) {
      return
    }

    const peer = new Peer(info, this)

    peer.on('alive', () => this.addUpdate(peer, 'alive'))
    peer.on('suspect', () => this.addUpdate(peer, 'suspect'))
    peer.on('faulty', () => this.addUpdate(peer, 'faulty'))

    peer.on('target', () => {
      const otherPeer = this.otherRandomPeer(peer)
      otherPeer.pingReq(peer)
    })

    this.peers.push(peer)

    return peer
  }

  async handleMessage (msg, { address, port } = {}) {
    let sender = this.getPeer(msg.sender_id)

    if (!sender) {
      sender = this.addPeer({
        address,
        port,
        id: msg.sender_id
      })
    }

    switch (msg.command) {
      case 'ack':
        this.handleAck(sender)
        break
      case 'ping':
        await this.handlePing(sender)
        break
      case 'ping-req':
        let target = this.getPeer(msg.target_id)

        if (!target) {
          target = this.addPeer({
            address: msg.target_address,
            port: msg.target_port,
            id: msg.target_id
          })
        }

        await this.handlePingReq(sender, target)
        break
      case 'event':
        this.handleEvent(sender, msg)
        break
      case 'event-req':
        this.handleEventReq(sender, msg)
        break
      default:
        return this.emit('unrecognized-command', msg.command)
    }

    msg.updates.forEach(update => this.handleUpdate(update))
  }

  handleAck (sender) {
    sender.emit('ack')
  }

  handlePing (sender) {
    sender.emit('ping')
    return sender.ack()
  }

  async handlePingReq (sender, target) {
    sender.emit('ping-req')
    await target.ping(false)
    const cb = () => sender.ack()
    target.once('ack', cb)
    setTimeout(() => target.removeListener('ack', cb), 2e3)
  }

  handleEvent (sender, msg) {
    sender.emit(msg.eventName)
  }

  handleEventReq (sender, msg) {
    this.once(msg.eventName, () => {
      sender.send({
        command: 'event',
        eventName: msg.eventName
      })
    })
  }

  handleUpdate (update) {
    if (this.id === update.id) {
      if (update.status === 'suspect' &&
          update.sequence === this.sequence) {
        this.sequence++
        this.addUpdate(this, 'alive')
      }
      return
    }

    let peer = this.getPeer(update.id)

    if (!peer) {
      if (update.status !== 'alive') return
      peer = this.addPeer(update)
    }

    peer.handleUpdate(update)
  }

  addUpdate ({ address, id, port, sequence }, status) {
    this.updates.push({
      address,
      count: 0,
      id,
      port,
      sequence,
      status
    })
  }

  get limit () {
    return Math.round(Math.log(this.peers.length + 1) * 3)
  }

  getUpdates () {
    const limit = this.limit

    this.updates = this.updates
      .filter(({ count }) => count < limit)
      .sort((a, b) => a.count > b.count ? 1 : -1)

    const numUpdates = Math.min(6, this.updates.length)

    for (let i = 0; i < numUpdates; i++) {
      this.updates[i].count++
    }

    const updates = this.updates.slice(0, numUpdates)

    return updates
  }
}

module.exports = Server
