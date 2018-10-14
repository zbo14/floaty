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
    this.nextIndex = 0
    this.peerArr = []
    this.peerMap = new Map()
    this.sequence = 0
    this.updates = []

    peers.forEach(peer => this.addPeer(peer))
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

  async requestState (id) {
    const peer = this.peerMap.get(id)

    if (!peer) {
      throw new Error(`Could not find peer with id: ${id}`)
    }

    const [ state ] = await Promise.all([
      new Promise(resolve => {
        peer.once('state', resolve)
      }),
      peer.send({ command: 'state-req' })
    ])

    return state
  }

  get state () {
    return [
      {
        id: this.id,
        status: 'alive',
        sequence: this.sequence
      },
      ...this.peerArr.map(peer => ({
        id: peer.id,
        status: peer.status,
        sequence: peer.sequence
      }))
    ].sort((a, b) => a.id > b.id ? 1 : -1)
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

    for (let i = 0, j; i < this.peerArr.length - 1; i++) {
      j = i + Math.floor(Math.random() * (this.peerArr.length - i))
      temp = this.peerArr[i]
      this.peerArr[i] = this.peerArr[j]
      this.peerArr[j] = temp
    }
  }

  runProtocolPeriod () {
    const peer = this.peerArr[this.nextIndex]

    if (++this.nextIndex === this.peerArr.length) {
      this.nextIndex = 0
      this.shufflePeers()
    }

    return peer.ping(true)
  }

  randomIndex (length = this.peerArr.length) {
    return Math.floor(Math.random() * length)
  }

  randomPeer () {
    return this.peerArr[this.randomIndex()]
  }

  otherRandomPeer (peer) {
    let otherPeer

    while (!otherPeer || peer.id === otherPeer.id) {
      otherPeer = this.randomPeer()
    }

    return otherPeer
  }

  addPeer (info) {
    if (info.id === this.id || this.peerMap.has(info.id)) {
      return
    }

    const peer = new Peer(info, this)
    const addUpdate = this.addUpdate.bind(this, peer)

    peer.on('alive', () => addUpdate('alive'))
    peer.on('faulty', () => addUpdate('faulty'))
    peer.on('suspect', () => addUpdate('suspect'))

    peer.on('target', () => {
      const otherPeer = this.otherRandomPeer(peer)
      otherPeer.pingReq(peer)
    })

    this.peerArr.push(peer)
    this.peerMap.set(peer.id, peer)

    return peer
  }

  async handleMessage (msg, { address, port } = {}) {
    let sender = this.peerMap.get(msg.sender_id)

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
        let target = this.peerMap.get(msg.target_id)

        if (!target) {
          target = this.addPeer({
            address: msg.target_address,
            port: msg.target_port,
            id: msg.target_id
          })
        }

        await this.handlePingReq(sender, target)
        break
      case 'state':
        this.handleState(sender, msg)
        break
      case 'state-req':
        await this.handleStateReq(sender)
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

  handleState (sender, msg) {
    sender.emit('state', msg.state)
  }

  handleStateReq (sender) {
    return sender.send({
      command: 'state',
      state: this.state
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

    let peer = this.peerMap.get(update.id)

    if (!peer) {
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
    return Math.round(Math.log(this.peerArr.length + 1) * 3)
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
