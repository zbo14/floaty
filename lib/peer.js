'use strict'

/**
 * @typedef {Object} Info
 *
 * @property {String} address
 * @property {Number} id
 * @property {Number} port
 * @property {String} sequence
 * @property {String} status
 */

/**
 * Represents a peer of the server.
 */
class Peer {
  /**
   * @param {Info}   info
   * @param {Server} server
   */
  constructor (info, server) {
    this.address = info.address
    this.id = info.id
    this.lastFaulty = -1
    this.port = info.port
    this.sequence = info.sequence || 0
    this.server = server
    this.status = info.status || 'alive'

    const cb = () => this.alive()
    this.on('ack', cb)
    this.on('ping', cb)
    this.on('ping-req', cb)
    this.on('event', cb)
    this.on('event-req', cb)
  }

  alive () {
    this.update('alive')
  }

  suspect () {
    if (this.status !== 'alive') return
    this.update('suspect')
    let timeout
    this.once('alive', () => clearTimeout(timeout))
    timeout = setTimeout(() => this.faulty(), 2e3)
  }

  faulty () {
    if (this.sequence > this.lastFaulty) {
      this.lastFaulty = this.sequence
      this.update('faulty')
    }
  }

  removeListener (eventName, listener) {
    this.server.removeListener(`${this.id}:${eventName}`, listener)
  }

  emit (eventName, ...params) {
    this.server.emit(`${this.id}:${eventName}`, ...params)
  }

  on (eventName, cb) {
    this.server.on(`${this.id}:${eventName}`, cb)
  }

  once (eventName, cb) {
    this.server.once(`${this.id}:${eventName}`, cb)
  }

  update (status) {
    if (this.status !== status) {
      this.emit(this.status = status)
    }
  }

  async send (msg) {
    msg.sender_id = this.server.id
    msg.updates = this.server.getUpdates()

    return new Promise(resolve => {
      this.server.socket.send(
        JSON.stringify(msg),
        this.port,
        this.address,
        () => resolve(msg)
      )
    })
  }

  async ping (target = true) {
    const msg = await this.send({ command: 'ping' })

    if (target) {
      let timeout
      this.once('ack', () => clearTimeout(timeout))
      timeout = setTimeout(() => this.emit('target'), 2e3)
    }

    return msg
  }

  ack () {
    return this.send({ command: 'ack' })
  }

  async pingReq (target) {
    const msg = await this.send({
      command: 'ping-req',
      target_address: target.address,
      target_id: target.id,
      target_port: target.port
    })

    let timeout
    this.once('ack', () => clearTimeout(timeout))
    target.once('ack', () => clearTimeout(timeout))
    timeout = setTimeout(() => target.suspect(), 2e3)

    return msg
  }

  handleUpdate ({ sequence, status }) {
    const mySequence = this.sequence

    if (sequence > mySequence) {
      this.emit('sequence', this.sequence = sequence)
    }

    switch (status) {
      case 'alive':
        if (this.status !== 'alive' && sequence > mySequence) {
          this.alive()
        }
        return
      case 'suspect':
        if (this.status === 'alive' && sequence >= mySequence) {
          this.suspect()
        }
        return
      case 'faulty':
        if (this.status !== 'faulty') {
          this.faulty()
        }
        return
      default:
        return this.emit('unrecognized-status', status)
    }
  }
}

module.exports = Peer
