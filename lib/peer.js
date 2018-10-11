'use strict'

/**
 * Represents a peer of the server.
 */
class Peer {
  /**
   * @param {Object} info
   * @param {String} info.address
   * @param {Number} info.id
   * @param {Number} info.port
   * @param {Server} server
   */
  constructor ({ id, port, address }, server) {
    this.address = address
    this.id = id
    this.port = port
    this.sequence = 0
    this.server = server
    this.status = 'alive'

    const cb = () => this.alive()
    this.on('ack', cb)
    this.on('ping', cb)
    this.on('ping-req', cb)
  }

  alive () {
    this.update('alive')
  }

  down () {
    this.update('down')
  }

  removeListener (eventName, listener) {
    this.server.removeListener(`${eventName}:${this.id}`, listener)
  }

  emit (eventName, ...params) {
    this.server.emit(`${eventName}:${this.id}`, ...params)
  }

  on (eventName, cb) {
    this.server.on(`${eventName}:${this.id}`, cb)
  }

  once (eventName, cb) {
    this.server.once(`${eventName}:${this.id}`, cb)
  }

  update (status) {
    if (this.status !== status) {
      this.emit(this.status = status)
    }
  }

  send (msg) {
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

  async pingReq (target) {
    const msg = await this.send({
      command: 'ping-req',
      target_id: target.id
    })

    let timeout
    this.once('ack', () => clearTimeout(timeout))
    target.once('ack', () => clearTimeout(timeout))
    timeout = setTimeout(() => target.suspect(), 2e3)

    return msg
  }

  ack () {
    return this.send({ command: 'ack' })
  }

  suspect () {
    if (this.status !== 'alive') return
    this.update('suspect')
    let timeout
    this.once('alive', () => clearTimeout(timeout))
    timeout = setTimeout(() => this.down(), 2e3)
  }

  handleUpdate ({ sequence, status }) {
    const mySequence = this.sequence

    if (sequence > mySequence) {
      this.emit('sequence', this.sequence = sequence)
    }

    switch (status) {
      case 'alive':
        if (this.status === 'suspect' && sequence > mySequence) {
          this.alive()
        }
        return
      case 'down':
        if (this.status !== 'down') {
          this.down()
        }
        return
      case 'suspect':
        if (this.status === 'alive' && sequence >= mySequence) {
          this.suspect()
        }
        return
      default:
        this.emit('unrecognized-status', status)
    }
  }
}

module.exports = Peer
