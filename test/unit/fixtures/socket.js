'use strict'

const EventEmitter = require('events')

module.exports = () => {
  const socket = new EventEmitter()

  socket.bind = (port, addr, cb) => cb()
  socket.close = () => {}

  return socket
}
