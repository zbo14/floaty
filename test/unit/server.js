'use strict'

/* eslint-env mocha */

const assert = require('assert')
const lolex = require('lolex')
const newPeers = require('./fixtures/peers')
const newSocket = require('./fixtures/socket')
const newUpdates = require('./fixtures/updates')
const Server = require('../../lib/server')

const id = 100
const port = 11000
const numPeers = 20

let clock
let peers
let server

const peer = id => server.peerMap.get(id)

describe('server', () => {
  beforeEach(async () => {
    clock = lolex.install()
    peers = newPeers({ id, port, numPeers })

    server = new Server({
      id: 0,
      address: '127.0.0.1',
      port: 3000
    })

    await server.setup(peers)

    server.nextIndex = 0
    server.status = 'alive'
    server.sequence = 1
    server.updates = []
  })

  afterEach(async () => {
    clock.uninstall()
    await server.teardown()
  })

  describe('#socket', () => {
    describe('#bind()', () => {
      it('mocks bind error', async () => {
        server.teardown()
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

  describe('#shufflePeers()', () => {
    it('shuffles peers once', () => {
      const peersBefore = server.peerArr.slice(0)
      server.shufflePeers()
      const peersAfter = server.peerArr.slice(0)
      assert.notDeepStrictEqual(peersAfter, peersBefore)
    })

    it('shuffles peers a bunch of times', () => {
      const peersBefore = server.peerArr.slice(0)
      for (let i = 0; i < 5; i++) {
        server.shufflePeers()
      }
      const peersAfter = server.peerArr.slice(0)
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

  describe('#state()', () => {
    it('checks initial state', () => {
      const actual = server.state
      const expected = [
        {
          id: 0,
          sequence: 1,
          status: 'alive'
        },
        ...server.peerArr.map(peer => ({
          id: peer.id,
          sequence: 0,
          status: 'alive'
        }))
      ]
      assert.deepStrictEqual(actual, expected)
    })

    it('checks state after peer status update', () => {
      peer(id).suspect()

      const state = server.state.find(peer => peer.id === id)

      assert.deepStrictEqual(state, {
        id,
        sequence: 0,
        status: 'suspect'
      })
    })
  })

  describe('#addUpdate()', () => {
    it('adds alive update for peer', () => {
      peer(id).emit('alive')

      assert.deepStrictEqual(server.updates, [
        {
          id,
          status: 'alive',
          count: 0,
          sequence: 0
        }
      ])
    })

    it('adds suspect update for peer', () => {
      peer(id).emit('suspect')

      assert.deepStrictEqual(server.updates, [
        {
          id,
          status: 'suspect',
          count: 0,
          sequence: 0
        }
      ])
    })

    it('adds down update for peer', () => {
      peer(id).emit('down')

      assert.deepStrictEqual(server.updates, [
        {
          id,
          status: 'down',
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
          status: 'down',
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
          status: 'down',
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
    it('handles update for unrecognized peer', done => {
      server.once('peer-not-found', id => {
        assert.strictEqual(id, 404)
        done()
      })

      server.handleUpdate({ id: 404, status: 'suspect', sequence: Infinity })
    })

    it('handles down update for peer', done => {
      peer(id).once('down', done)
      server.handleUpdate({ id, status: 'down', sequence: 1 })
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
          count: 0,
          id: 0,
          status: 'alive',
          sequence: 2
        }
      ])
    })
  })

  describe('#handleMessage()', () => {
    it('handles message with unrecognized sender', done => {
      server.once('peer-not-found', id => {
        assert.strictEqual(id, 404)
        done()
      })

      server.handleMessage({
        command: 'ping',
        sender_id: 404,
        updates: []
      })
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
          peer(id).ack = resolve
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
        const promise = new Promise(resolve => {
          peer(id).ack = resolve
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
          id,
          count: 0,
          sequence: 100,
          status: 'suspect'
        }])
      })
    })

    describe('#handleMessage(\'ack\')', () => {
      it('handles ack for peer', done => {
        peer(id).once('ack', () => {
          assert.strictEqual(peer(id).status, 'alive')
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
      it('handles ping-req with unrecognized target', done => {
        server.once('peer-not-found', id => {
          assert.strictEqual(id, 404)
          done()
        })

        server.handleMessage({
          command: 'ping-req',
          sender_id: id,
          target_id: 404,
          updates: []
        })
      })

      it('handles ping-req that doesn\'t receive ack', done => {
        peer(id + 1).once('ack', () => {
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
          peer(id).ack = resolve
        })

        await server.handleMessage({
          command: 'ping-req',
          sender_id: id,
          target_id: id + 1,
          updates: []
        })

        peer(id + 1).emit('ack', true)

        await promise
      })
    })
  })

  describe('#runProtocolPeriod()', () => {
    it('runs protocol period', async () => {
      assert.strictEqual(server.nextIndex, 0)
      await server.runProtocolPeriod()
      assert.strictEqual(server.nextIndex, 1)
    })

    it('runs protocol period for each peer and then shuffles peers', async () => {
      const peersBefore = server.peerArr.slice(0)

      for (let i = 0; i < numPeers; i++) {
        assert.strictEqual(server.nextIndex, i)
        assert.deepStrictEqual(server.peerArr, peersBefore)
        await server.runProtocolPeriod()
      }

      assert.strictEqual(server.nextIndex, 0)
      assert.notDeepStrictEqual(server.peerArr, peersBefore)
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
