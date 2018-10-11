'use strict'

const EventEmitter = require('events')

const server = new EventEmitter()

server.id = 1

server.socket = {
  send: (msg, port, addr, cb) => cb()
}

server.getUpdates = () => [
  {
    id: 2,
    status: 'alive',
    sequence: 0,
    count: 3
  },
  {
    id: 3,
    status: 'suspect',
    sequence: 2,
    count: 1
  }
]

module.exports = server
