'use strict'

const EventEmitter = require('events')

const target = new EventEmitter()

target.id = 5

target.suspect = () => {}

module.exports = () => target
