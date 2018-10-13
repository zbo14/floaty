'use strict'

/* eslint-env mocha */

const assert = require('assert')
const { promisify } = require('util')
const exec = promisify(require('child_process').exec)
const Server = require('../lib/server')
const peers = require('../nodes.json')
  .map(peer => {
    peer.address = '0.0.0.0'
    return peer
  })

let server

describe('integration', () => {
  before(async function () {
    this.timeout(10e3)
    await exec('docker-compose up --build -d')
  })

  after(async function () {
    this.timeout(10e3)
    await exec('docker-compose down && rm docker-compose.yml nodes.json')
  })

  beforeEach(() => {
    server = new Server({
      address: '0.0.0.0',
      port: 9000,
      id: 0
    })

    server.setup(peers)
  })

  afterEach(() => {
    server.teardown()
  })

  it('requests state from random peer', async () => {
    const peer = server.randomPeer()
    const state = await server.requestState(peer.id)

    assert.deepStrictEqual(state, [
      {
        id: 0,
        status: 'alive',
        sequence: 0
      },
      ...peers.map(({ id }) => ({
        id,
        status: 'alive',
        sequence: 0
      }))
    ])
  })

  it('stops a node', async () => {
    await exec('docker-compose stop node1')
  })

  it('waits a bit', done => {
    setTimeout(done, 15e3)
  }).timeout(20e3)

  it('requests state from other peer and checks that node is down', async () => {
    const state = await server.requestState(peers[2].id)
    const peer = state.find(({ id }) => id === peers[1].id)

    assert.deepStrictEqual(peer, {
      id: peers[1].id,
      status: 'down',
      sequence: 0
    })
  })

  it('starts the node up again', async () => {
    await exec('docker-compose start node1')
  })

  it('waits a bit', done => {
    setTimeout(done, 15e3)
  }).timeout(20e3)

  it('requests state from another peer and checks that node is alive', async () => {
    const state = await server.requestState(peers[3].id)
    const peer = state.find(({ id }) => id === peers[1].id)

    assert.deepStrictEqual(peer, {
      id: peers[1].id,
      status: 'alive',
      sequence: 0
    })
  })
})
