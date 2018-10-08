'use strict'

/**
 * Peer
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
    this.on('ping', cb)
    this.on('ping-req', cb)
    this.on('ack', cb)
  }

  alive () {
    this.update('alive')
  }

  down () {
    this.update('down')
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

    return new Promise((resolve, reject) => {
      this.server.socket.send(
        JSON.stringify(msg),
        this.port,
        this.address,
        err => err ? reject(err) : resolve(msg)
      )
    })
  }

  async ping (target = true) {
    const msg = await this.send({ command: 'ping' })

    if (target) {
      const timeout = setTimeout(() => this.emit('target'), 1e3)
      this.once('ack', () => clearTimeout(timeout))
    }

    return msg
  }

  async pingReq (target) {
    const msg = await this.send({
      command: 'ping-req',
      target_id: target.id
    })

    const timeout = setTimeout(() => target.suspect(), 1e3)

    this.once('ack', () => clearTimeout(timeout))
    target.once('ack', () => clearTimeout(timeout))

    return msg
  }

  ack () {
    return this.send({ command: 'ack' })
  }

  suspect () {
    const timeout = setTimeout(() => this.down(), 1e3)
    this.once('alive', () => clearTimeout(timeout))
    this.update('suspect')
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
