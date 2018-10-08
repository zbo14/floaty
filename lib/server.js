'use strict'

const dgram = require('dgram')
const EventEmitter = require('events')
const Peer = require('./peer')

/**
 * @typedef   {Object}   Message
 *
 * @property  {String}   command     - the message command.
 * @property  {Number}   sender_id   - the id of the server that sent the message.
 * @property  {Number}   [target_id] - the id of the target peer in a ping-req.
 * @property  {Update[]} updates     - the updates piggybacked on the message.
 */

/**
 * @typedef   {Object}  Update
 *
 * @property  {Number}  count    - the number of times the update has been sent.
 * @property  {Number}  id       - the id of the peer being updated.
 * @property  {Number}  sequence - the sequence number of the peer being updated.
 * @property  {String}  status   - the updated status.
 */

/**
 * Server
 *
 * @extends EventEmitter
 */
class Server extends EventEmitter {
  /**
   * @param {Object} info
   * @param {String} info.address
   * @param {Number} info.id
   * @param {Number} info.port
   */
  constructor ({ id, port, address }) {
    super()
    this.setMaxListeners(Infinity)

    this.address = address
    this.id = id
    this.port = port
  }

  /**
   * @param  {Object[]} peers
   *
   * @return {Promise}
   */
  setup (peers) {
    this.nextIndex = 0
    this.peerMap = new Map()
    this.sequence = 0
    this.updates = []

    peers.forEach(peer => this.addPeer(peer))

    this.peerArr = [...this.peerMap]

    return this.openSocket()
  }

  /**
   * teardown
   */
  teardown () {
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
      this.timeout = setTimeout(() => this.start(), 1e3)
    }
  }

  /**
   * stop
   */
  stop () {
    clearTimeout(this.timeout)
  }

  openSocket (socket) {
    let msg

    this.socket = socket || dgram.createSocket('udp4')

    this.socket.on('message', async buf => {
      try {
        msg = buf.toString()
        msg = JSON.parse(msg)
      } catch (_) {
        this.emit('error', new Error(`Invalid message: "${msg}"`))
      }

      try {
        await this.handleMessage(msg)
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

    this.peerMap = new Map(this.peerArr)
  }

  runProtocolPeriod () {
    const peer = this.peerArr[this.nextIndex][1]

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
    return this.peerArr[this.randomIndex()][1]
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
      return false
    }

    const peer = new Peer(info, this)
    const addUpdate = this.addUpdate.bind(this, peer)

    peer.on('alive', () => addUpdate('alive'))
    peer.on('down', () => addUpdate('down'))
    peer.on('suspect', () => addUpdate('suspect'))

    peer.on('target', () => {
      const otherPeer = this.otherRandomPeer(peer)
      otherPeer.pingReq(peer)
    })

    this.peerMap.set(peer.id, peer)

    return true
  }

  async handleMessage (msg) {
    const sender = this.peerMap.get(msg.sender_id)

    if (!sender) {
      return this.emit('peer-not-found', msg.sender_id)
    }

    switch (msg.command) {
      case 'ack':
        this.handleAck(sender)
        break
      case 'ping':
        await this.handlePing(sender)
        break
      case 'ping-req':
        const target = this.peerMap.get(msg.target_id)

        if (!target) {
          return this.emit('peer-not-found', msg.target_id)
        }

        await this.handlePingReq(sender, target)
        break
      default:
        return this.emit('unrecognized-command', msg.command)
    }

    msg.updates.forEach(update => this.handleUpdate(update))
  }

  handleAck (sender) {
    sender.emit('ack', true)
  }

  handlePing (sender) {
    return sender.ack()
  }

  async handlePingReq (sender, target) {
    await target.ping(false)

    target.once('ack', ack => {
      if (ack) {
        sender.ack()
      }
    })

    setTimeout(() => target.emit('ack', false), 1e3)
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

    const peer = this.peerMap.get(update.id)

    if (!peer) {
      return this.emit('peer-not-found', update.id)
    }

    peer.handleUpdate(update)
  }

  addUpdate ({ id, sequence }, status) {
    this.updates.push({
      count: 0,
      id,
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

    return this.updates.slice(0, numUpdates)
  }
}

module.exports = Server
