'use strict'

/* eslint-env mocha */

const { promisify } = require('util')
const exec = promisify(require('child_process').exec)
const init = require('../scripts/init')
const Server = require('../lib/server')

const id = 100
const numNodes = 40
const port = 22223
const timeout = 80e3

let peers
let server

describe('integration', () => {
  before(async function () {
    this.timeout(timeout)
    await init({ numNodes, id, port })
    await exec('docker-compose up --build -d')
    peers = require('../nodes')
  })

  after(async function () {
    this.timeout(timeout)
    await exec('docker-compose down && rm docker-compose.yml nodes.json')
  })

  beforeEach(async () => {
    server = new Server({
      address: '0.0.0.0',
      port: 9000,
      id: 0
    })

    const myPeers = peers.map(peer => ({ ...peer, address: '0.0.0.0' }))

    server.init(myPeers)

    await server.openSocket()
  })

  afterEach(() => {
    server.closeSocket()
  })

  it('stops a node', async () => {
    await exec('docker-compose stop node0')
  }).timeout(timeout)

  it('waits for other peers to notice node is down', async () => {
    await Promise.all(
      peers.slice(1).map(({ id }) => {
        return server.eventReq(id, '100:faulty', timeout)
      })
    )
  }).timeout(timeout)

  it('starts a node', async () => {
    await exec('docker-compose start node0')
  }).timeout(timeout)

  it('waits for other peers to notice node is alive', async () => {
    await Promise.all([
      ...peers.slice(1).map(({ id }) => {
        return server.eventReq(id, '100:alive', timeout)
      }),
      exec('docker-compose start node0')
    ])
  }).timeout(timeout)
})
