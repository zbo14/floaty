'use strict'

const EventEmitter = require('events')

const target = new EventEmitter()

target.address = '1.2.3.4'
target.id = 5
target.port = 9999

target.suspect = () => {}

module.exports = () => target
