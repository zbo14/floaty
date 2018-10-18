'use strict'

/* eslint-env mocha */

const assert = require('assert')
const lolex = require('lolex')
const newPeers = require('./fixtures/peers')
const newSocket = require('./fixtures/socket')
const newUpdates = require('./fixtures/updates')
const Peer = require('../../lib/peer')
const Server = require('../../lib/server')

const id = 100
const port = 11000
const numPeers = 20

let clock
let peers
let server

const getPeer = id => server.getPeer(id)

describe('server', () => {
  beforeEach(async () => {
    clock = lolex.install()
    peers = newPeers({ id, port, numPeers })

    server = new Server({
      id: 0,
      address: '127.0.0.1',
      port: 3000
    })

    server.init(peers)

    await server.openSocket()

    server.nextIndex = 0
    server.status = 'alive'
    server.sequence = 1
    server.updates = []
  })

  afterEach(async () => {
    clock.uninstall()
    await server.closeSocket()
  })

  describe('#constructor()', () => {
    it('sets up server with no peers', async () => {
      await server.init()
      assert.deepStrictEqual(server.peers, [])
    })
  })

  describe('#socket', () => {
    describe('#bind()', () => {
      it('mocks bind error', async () => {
        server.closeSocket()
        const socket = newSocket()
        socket.bind = (port, addr, cb) => cb(new Error('whoops'))

        try {
          await server.openSocket(socket)
          assert.ok(false, 'should have thrown error')
        } catch (err) {
          assert.notStrictEqual(err.message, 'should have thrown error')
        }
      })
    })

    describe('#on(\'message\')', () => {
      let handleMessage

      beforeEach(() => {
        handleMessage = server.handleMessage
      })

      afterEach(() => {
        server.handleMessage = handleMessage
      })

      it('receives invalid message on socket', async () => {
        const promise = new Promise(resolve => {
          server.once('error', err => {
            assert.strictEqual(err.message, 'Invalid message: "{ "foo": "bar", }"')
            resolve()
          })
        })

        server.socket.emit('message', '{ "foo": "bar", }')

        await promise
      })

      it('mocks error when handling message', async () => {
        server.handleMessage = () => Promise.reject(new Error('whoops'))

        const promise = new Promise(resolve => {
          server.once('error', err => {
            assert.strictEqual(err.message, 'whoops')
            resolve()
          })
        })

        server.socket.emit('message', '{ "foo": "bar" }')

        await promise
      })
    })
  })

  describe('#peersOnline', () => {
    it('gets online peers', () => {
      assert.deepStrictEqual(server.peersOnline, server.peers)
    })

    it('gets online peers when one is suspect', () => {
      server.peers[0].status = 'suspect'
      assert.deepStrictEqual(server.peersOnline, server.peers)
    })

    it('gets online peers when one is faulty', () => {
      server.peers[0].status = 'faulty'
      assert.deepStrictEqual(server.peersOnline, server.peers.slice(1))
    })
  })

  describe('#shufflePeers()', () => {
    it('shuffles peers once', () => {
      const peersBefore = server.peers.slice(0)
      server.shufflePeers()
      const peersAfter = server.peers.slice(0)
      assert.notDeepStrictEqual(peersAfter, peersBefore)
    })

    it('shuffles peers a bunch of times', () => {
      const peersBefore = server.peers.slice(0)
      for (let i = 0; i < 5; i++) {
        server.shufflePeers()
      }
      const peersAfter = server.peers.slice(0)
      assert.notDeepStrictEqual(peersAfter, peersBefore)
    })
  })

  describe('#addPeer()', () => {
    it('fails to add itself as a peer', () => {
      const result = server.addPeer({
        id: 0,
        address: '127.0.0.1',
        port: 3000
      })

      assert.strictEqual(result, undefined)
    })

    it('fails to add peer it already has', () => {
      const result = server.addPeer({
        id,
        address: '127.0.0.1',
        port
      })

      assert.strictEqual(result, undefined)
    })
  })

  describe('#addUpdate()', () => {
    it('adds alive update for peer', () => {
      const peer = getPeer(id)
      peer.emit('alive')

      assert.deepStrictEqual(server.updates, [
        {
          address: peer.address,
          id,
          port: peer.port,
          status: 'alive',
          count: 0,
          sequence: 0
        }
      ])
    })

    it('adds suspect update for peer', () => {
      const peer = getPeer(id)
      peer.emit('suspect')

      assert.deepStrictEqual(server.updates, [
        {
          address: peer.address,
          id,
          port: peer.port,
          status: 'suspect',
          count: 0,
          sequence: 0
        }
      ])
    })

    it('adds faulty update for peer', () => {
      const peer = getPeer(id)
      peer.emit('faulty')

      assert.deepStrictEqual(server.updates, [
        {
          address: peer.address,
          id,
          port: peer.port,
          status: 'faulty',
          count: 0,
          sequence: 0
        }
      ])
    })
  })

  describe('#getUpdates()', () => {
    it('gets 6 youngest updates', () => {
      const limit = server.limit
      server.updates = newUpdates({ id, limit, numUpdates: 100 })
      const updates = server.getUpdates()

      assert(updates.every(({ count }) => count <= limit))
      assert.strictEqual(updates.length, 6)
    })

    it('gets <6 youngest updates', () => {
      const limit = server.limit
      server.updates = newUpdates({ id, limit, numUpdates: 5 })
      const updates = server.getUpdates()

      assert(updates.every(({ count }) => count <= limit))
      assert(updates.length < 6)
    })

    it('gets youngest updates multiple times, removing those that reach limit', () => {
      const limit = server.limit

      server.updates = [
        {
          id: 103,
          status: 'suspect',
          sequence: 2,
          count: limit - 3
        },
        {
          id: 100,
          status: 'alive',
          sequence: 2,
          count: limit - 2
        },
        {
          id: 101,
          status: 'suspect',
          sequence: 2,
          count: limit - 1
        },
        {
          id: 102,
          status: 'alive',
          sequence: 2,
          count: limit - 1
        },
        {
          id: 104,
          status: 'faulty',
          sequence: 2,
          count: limit - 1
        },
        {
          id: 100,
          status: 'alive',
          sequence: 2,
          count: limit
        }
      ]

      assert.deepStrictEqual(server.getUpdates(), [
        {
          id: 103,
          status: 'suspect',
          sequence: 2,
          count: limit - 2
        },
        {
          id: 100,
          status: 'alive',
          sequence: 2,
          count: limit - 1
        },
        {
          id: 101,
          status: 'suspect',
          sequence: 2,
          count: limit
        },
        {
          id: 102,
          status: 'alive',
          sequence: 2,
          count: limit
        },
        {
          id: 104,
          status: 'faulty',
          sequence: 2,
          count: limit
        }
      ])

      assert.deepStrictEqual(server.getUpdates(), [
        {
          id: 103,
          status: 'suspect',
          sequence: 2,
          count: limit - 1
        },
        {
          id: 100,
          status: 'alive',
          sequence: 2,
          count: limit
        }
      ])
    })
  })

  describe('#handleUpdate()', () => {
    it('handles alive update for unrecognized peer', async () => {
      assert.strictEqual(getPeer(404), undefined)

      await server.handleUpdate({
        address: 'localhost',
        id: 404,
        port: 9000,
        status: 'alive',
        sequence: 1
      })

      const { address, id, port } = getPeer(404)
      assert.strictEqual(address, 'localhost')
      assert.strictEqual(id, 404)
      assert.strictEqual(port, 9000)
    })

    it('handles suspect update for unrecognized peer', async () => {
      assert.strictEqual(getPeer(404), undefined)

      await server.handleUpdate({
        address: 'localhost',
        id: 404,
        port: 9000,
        status: 'suspect',
        sequence: 1
      })

      assert.strictEqual(getPeer(404), undefined)
    })

    it('handles faulty update for unrecognized peer', async () => {
      assert.strictEqual(getPeer(404), undefined)

      await server.handleUpdate({
        address: 'localhost',
        id: 404,
        port: 9000,
        status: 'faulty',
        sequence: 1
      })

      assert.strictEqual(getPeer(404), undefined)
    })

    it('handles faulty update for peer', done => {
      getPeer(id).once('faulty', done)
      server.handleUpdate({ id, status: 'faulty', sequence: 1 })
    })

    it('handles alive update for server', () => {
      server.handleUpdate({ id: 0, status: 'alive', sequence: 1 })
      assert.deepStrictEqual(server.updates, [])
    })

    it('handles suspect update with lower sequence number for server', () => {
      server.handleUpdate({ id: 0, status: 'suspect', sequence: 0 })
      assert.deepStrictEqual(server.updates, [])
    })

    it('handles suspect update with same sequence number for server', () => {
      server.handleUpdate({ id: 0, status: 'suspect', sequence: 1 })
      assert.deepStrictEqual(server.updates, [
        {
          address: server.address,
          count: 0,
          id: 0,
          port: server.port,
          status: 'alive',
          sequence: 2
        }
      ])
    })
  })

  describe('#handleMessage()', () => {
    it('adds peer it doesn\'t have', () => {
      server.handleMessage(
        {
          command: 'ping',
          sender_id: 404,
          updates: []
        },
        {
          address: '1.2.3.4',
          port: 5678
        }
      )

      const peer = getPeer(404)

      assert(peer instanceof Peer)

      assert.strictEqual(peer.id, 404)
      assert.strictEqual(peer.address, '1.2.3.4')
      assert.strictEqual(peer.port, 5678)
    })

    it('handles message with unrecognized command', done => {
      server.once('unrecognized-command', command => {
        assert.strictEqual(command, 'pong')
        done()
      })

      server.handleMessage({
        command: 'pong',
        sender_id: id,
        updates: []
      })
    })

    describe('#handleMessage(\'ping\')', () => {
      it('handles a ping', async () => {
        const promise = new Promise(resolve => {
          getPeer(id).ack = resolve
        })

        await Promise.all([
          server.handleMessage({
            command: 'ping',
            sender_id: id,
            updates: []
          }),
          promise
        ])
      })

      it('handles a ping message with updates', async () => {
        const peer = getPeer(id)

        const promise = new Promise(resolve => {
          peer.ack = resolve
        })

        await Promise.all([
          server.handleMessage({
            command: 'ping',
            sender_id: id,
            updates: [{
              id,
              sequence: 100,
              status: 'suspect'
            }]
          }),
          promise
        ])

        assert.deepStrictEqual(server.updates, [{
          address: peer.address,
          id,
          port: peer.port,
          count: 0,
          sequence: 100,
          status: 'suspect'
        }])
      })
    })

    describe('#handleMessage(\'ack\')', () => {
      it('handles ack for peer', done => {
        getPeer(id).once('ack', () => {
          assert.strictEqual(getPeer(id).status, 'alive')
          done()
        })

        server.handleMessage({
          command: 'ack',
          sender_id: id,
          updates: []
        })
      })
    })

    describe('#handleMessage(\'ping-req\')', () => {
      it('handles ping-req and adds target', async () => {
        assert.strictEqual(getPeer(404), undefined)

        await server.handleMessage({
          command: 'ping-req',
          sender_id: id,
          target_address: '127.0.0.1',
          target_id: 404,
          target_port: 4000,
          updates: []
        })

        const peer = getPeer(404)
        assert(peer)
        assert.strictEqual(peer.address, '127.0.0.1')
        assert.strictEqual(peer.id, 404)
        assert.strictEqual(peer.port, 4000)
      })

      it('handles ping-req that doesn\'t receive ack', done => {
        getPeer(id + 1).once('ack', () => {
          done(new Error('shouldn\'t have gotten here'))
        })

        server.handleMessage({
          command: 'ping-req',
          sender_id: id,
          target_id: id + 1,
          updates: []
        })
          .then(result => {
            clock.tick(2e3)
            done()
          })
          .catch(done)
      })

      it('handles ping-req that receives ack', async () => {
        const promise = new Promise(resolve => {
          getPeer(id).ack = resolve
        })

        await server.handleMessage({
          command: 'ping-req',
          sender_id: id,
          target_id: id + 1,
          updates: []
        })

        getPeer(id + 1).emit('ack', true)

        await promise
      })
    })

    describe('#handleMessage(\'event\')', () => {
      it('handles event message', done => {
        getPeer(id).once('foobar', result => {
          assert.strictEqual(result, undefined)
          done()
        })

        server.handleMessage({
          command: 'event',
          eventName: 'foobar',
          sender_id: id,
          updates: []
        })
      })
    })

    describe('#handleMessage(\'event-req\')', () => {
      it('handles event-req message', done => {
        const peer = getPeer(id)

        peer.send = msg => {
          assert.deepStrictEqual(msg, {
            command: 'event',
            eventName: 'foobar'
          })
          done()
        }

        server.handleMessage({
          command: 'event-req',
          eventName: 'foobar',
          sender_id: id,
          updates: []
        })

        server.emit('foobar')
      })
    })
  })

  describe('#eventReq()', () => {
    it('mocks event request to peer', async () => {
      const promise = server.eventReq(id, 'foobar')
      getPeer(id).emit('foobar')
      await promise
    })

    it('mocks event request that times out', async () => {
      const promise = server.eventReq(id)
      clock.tick(10e3)

      try {
        await promise
        assert.ok(false, 'should have thrown error')
      } catch (err) {
        assert.strictEqual(err.message, 'Request timed out')
      }
    })

    it('fails to make event request to peer it doesn\'t know', async () => {
      try {
        await server.eventReq(404)
        assert.ok(false, 'should have thrown error')
      } catch (err) {
        assert.strictEqual(err.message, 'Could not find peer with id: 404')
      }
    })
  })

  describe('#runProtocolPeriod()', () => {
    it('runs protocol period for each peer and then shuffles peers', async () => {
      const peersBefore = server.peers.slice(0)

      for (let i = 0; i <= numPeers; i++) {
        assert.deepStrictEqual(server.peers, peersBefore)
        await server.runProtocolPeriod()
      }

      assert.notDeepStrictEqual(server.peers, peersBefore)
    })
  })

  describe('#start()', () => {
    let runProtocolPeriod

    beforeEach(() => {
      runProtocolPeriod = server.runProtocolPeriod
    })

    afterEach(() => {
      server.stop()
      server.runProtocolPeriod = runProtocolPeriod
    })

    it('mocks error', async () => {
      server.runProtocolPeriod = () => Promise.reject(new Error('whoops'))

      const promise = new Promise(resolve => {
        server.once('error', err => {
          assert.strictEqual(err.message, 'whoops')
          resolve()
        })
      })

      await Promise.all([
        server.start(),
        promise
      ])
    })

    it('starts and then recursively calls start again', async () => {
      await server.start()

      const promise = new Promise(resolve => {
        server.runProtocolPeriod = resolve
      })

      clock.tick(2e3)

      await promise
    })
  })
})
