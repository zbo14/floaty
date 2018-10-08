'use strict'

/* eslint-env mocha */

const assert = require('assert')
const lolex = require('lolex')
const Peer = require('../lib/peer')
const server = require('./fixtures/server')
const newTarget = require('./fixtures/target')

const updates = [
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

let clock
let peer
let target

describe('peer', () => {
  beforeEach(() => {
    clock = lolex.install()
    peer = new Peer(
      {
        id: 4,
        address: '127.0.0.1',
        port: 3004
      },
      server
    )
  })

  afterEach(() => {
    clock.uninstall()
    server.removeAllListeners()
  })

  describe('#send()', () => {
    let send

    before(() => {
      send = server.socket.send
      server.socket.send = (msg, port, addr, cb) => {
        cb(new Error('whoops'))
      }
    })

    after(() => {
      server.socket.send = send
    })

    it('mocks send error on server socket', async () => {
      try {
        await peer.send({ foo: 'bar' })
        assert.ok(false, 'should have thrown error')
      } catch (err) {
        assert.strictEqual(err.message, 'whoops')
      }
    })
  })

  describe('#ping()', () => {
    it('mocks ping that doesn\'t receive ack', async () => {
      const promise = new Promise(resolve => peer.once('target', resolve))
      const msg = await peer.ping()

      assert.deepStrictEqual(msg, {
        command: 'ping',
        sender_id: 1,
        updates
      })

      clock.tick(1e3)

      await promise
    })

    it('mocks ping that receives ack', async () => {
      const msg = await peer.ping()

      assert.deepStrictEqual(msg, {
        command: 'ping',
        sender_id: 1,
        updates
      })

      peer.emit('ack')
    })

    it('mocks ping without targeting', async () => {
      const msg = await peer.ping(false)

      assert.deepStrictEqual(msg, {
        command: 'ping',
        sender_id: 1,
        updates
      })
    })
  })

  describe('#ack()', () => {
    it('mocks ack', async () => {
      const msg = await peer.ack()

      assert.deepStrictEqual(msg, {
        command: 'ack',
        sender_id: 1,
        updates
      })
    })
  })

  describe('#pingReq()', () => {
    beforeEach(() => {
      target = newTarget()
    })

    it('mocks pingReq that receives ack from intermediary', async () => {
      const msg = await peer.pingReq(target)

      assert.deepStrictEqual(msg, {
        command: 'ping-req',
        sender_id: 1,
        target_id: 5,
        updates
      })

      peer.emit('ack')
    })

    it('mocks pingReq that receives ack from target', async () => {
      const msg = await peer.pingReq(target)

      assert.deepStrictEqual(msg, {
        command: 'ping-req',
        sender_id: 1,
        target_id: 5,
        updates
      })

      target.emit('ack')
    })

    it('mocks pingReq that times out', async () => {
      const promise = new Promise(resolve => {
        target.suspect = resolve
      })

      const msg = await peer.pingReq(target)

      assert.deepStrictEqual(msg, {
        command: 'ping-req',
        sender_id: 1,
        target_id: 5,
        updates
      })

      clock.tick(1e3)

      await promise
    })
  })

  describe('#suspect()', () => {
    it('suspects and then marks peer down', async () => {
      const promise1 = new Promise(resolve => peer.once('suspect', resolve))
      const promise2 = new Promise(resolve => peer.once('down', resolve))
      peer.suspect()
      await promise1
      clock.tick(1e3)
      await promise2
      assert.strictEqual(peer.status, 'down')
    })

    it('suspects and then marks peer alive', async () => {
      const promise1 = new Promise(resolve => peer.once('suspect', resolve))
      const promise2 = new Promise(resolve => peer.once('alive', resolve))
      peer.suspect()
      await promise1
      peer.alive()
      await promise2
      assert.strictEqual(peer.status, 'alive')
    })
  })

  describe('#handleUpdate()', () => {
    it('handles update with unrecognized status', async () => {
      const promise = new Promise(resolve => {
        peer.once('unrecognized-status', status => {
          assert.strictEqual(status, 'foo')
          resolve()
        })
      })

      peer.handleUpdate({ status: 'foo', sequence: 0 })

      await promise
    })

    describe('#status:alive', () => {
      beforeEach(() => {
        peer.status = 'alive'
        peer.sequence = 1
      })

      describe('#handleUpdate(\'alive\')', () => {
        it('handles alive update with lower sequence number', () => {
          peer.handleUpdate({ status: 'alive', sequence: 0 })
          assert.strictEqual(peer.status, 'alive')
          assert.strictEqual(peer.sequence, 1)
        })

        it('handles alive update with same sequence number', () => {
          peer.handleUpdate({ status: 'alive', sequence: 1 })
          assert.strictEqual(peer.status, 'alive')
          assert.strictEqual(peer.sequence, 1)
        })

        it('handles alive update with higher sequence number', () => {
          peer.handleUpdate({ status: 'alive', sequence: 2 })
          assert.strictEqual(peer.status, 'alive')
          assert.strictEqual(peer.sequence, 2)
        })
      })

      describe('#handleUpdate(\'suspect\')', () => {
        it('handles suspect update with lower sequence number', () => {
          peer.handleUpdate({ status: 'suspect', sequence: 0 })
          assert.strictEqual(peer.status, 'alive')
          assert.strictEqual(peer.sequence, 1)
        })

        it('handles alive update with same sequence number', async () => {
          const promise = new Promise(resolve => peer.once('suspect', resolve))
          peer.handleUpdate({ status: 'suspect', sequence: 1 })
          assert.strictEqual(peer.status, 'suspect')
          assert.strictEqual(peer.sequence, 1)
          await promise
        })

        it('handles alive update with higher sequence number', async () => {
          const promise = new Promise(resolve => peer.once('suspect', resolve))
          peer.handleUpdate({ status: 'suspect', sequence: 2 })
          assert.strictEqual(peer.status, 'suspect')
          assert.strictEqual(peer.sequence, 2)
          await promise
        })
      })

      describe('#handleUpdate(\'down\')', () => {
        it('handles suspect update with lower sequence number', async () => {
          const promise = new Promise(resolve => peer.once('down', resolve))
          peer.handleUpdate({ status: 'down', sequence: 0 })
          assert.strictEqual(peer.status, 'down')
          assert.strictEqual(peer.sequence, 1)
          await promise
        })

        it('handles alive update with same sequence number', async () => {
          const promise = new Promise(resolve => peer.once('down', resolve))
          peer.handleUpdate({ status: 'down', sequence: 1 })
          assert.strictEqual(peer.status, 'down')
          assert.strictEqual(peer.sequence, 1)
          await promise
        })

        it('handles alive update with higher sequence number', async () => {
          const promise = new Promise(resolve => peer.once('down', resolve))
          peer.handleUpdate({ status: 'down', sequence: 2 })
          assert.strictEqual(peer.status, 'down')
          assert.strictEqual(peer.sequence, 2)
          await promise
        })
      })
    })

    describe('#status:down', () => {
      beforeEach(() => {
        peer.status = 'down'
        peer.sequence = 1
      })

      describe('#handleUpdate(\'alive\')', () => {
        it('handles alive update with lower sequence number', () => {
          peer.handleUpdate({ status: 'alive', sequence: 0 })
          assert.strictEqual(peer.status, 'down')
          assert.strictEqual(peer.sequence, 1)
        })

        it('handles alive update with same sequence number', () => {
          peer.handleUpdate({ status: 'alive', sequence: 1 })
          assert.strictEqual(peer.status, 'down')
          assert.strictEqual(peer.sequence, 1)
        })

        it('handles alive update with higher sequence number', () => {
          peer.handleUpdate({ status: 'alive', sequence: 2 })
          assert.strictEqual(peer.status, 'down')
          assert.strictEqual(peer.sequence, 2)
        })
      })

      describe('#handleUpdate(\'suspect\')', () => {
        it('handles suspect update with lower sequence number', () => {
          peer.handleUpdate({ status: 'suspect', sequence: 0 })
          assert.strictEqual(peer.status, 'down')
          assert.strictEqual(peer.sequence, 1)
        })

        it('handles alive update with same sequence number', () => {
          peer.handleUpdate({ status: 'suspect', sequence: 1 })
          assert.strictEqual(peer.status, 'down')
          assert.strictEqual(peer.sequence, 1)
        })

        it('handles alive update with higher sequence number', () => {
          peer.handleUpdate({ status: 'suspect', sequence: 2 })
          assert.strictEqual(peer.status, 'down')
          assert.strictEqual(peer.sequence, 2)
        })
      })

      describe('#handleUpdate(\'down\')', () => {
        it('handles suspect update with lower sequence number', () => {
          peer.handleUpdate({ status: 'down', sequence: 0 })
          assert.strictEqual(peer.status, 'down')
          assert.strictEqual(peer.sequence, 1)
        })

        it('handles alive update with same sequence number', async () => {
          peer.handleUpdate({ status: 'down', sequence: 1 })
          assert.strictEqual(peer.status, 'down')
          assert.strictEqual(peer.sequence, 1)
        })

        it('handles alive update with higher sequence number', async () => {
          peer.handleUpdate({ status: 'down', sequence: 2 })
          assert.strictEqual(peer.status, 'down')
          assert.strictEqual(peer.sequence, 2)
        })
      })
    })

    describe('#status:suspect', () => {
      beforeEach(() => {
        peer.status = 'suspect'
        peer.sequence = 1
      })

      describe('#handleUpdate(\'alive\')', () => {
        it('handles alive update with lower sequence number', () => {
          peer.handleUpdate({ status: 'alive', sequence: 0 })
          assert.strictEqual(peer.status, 'suspect')
          assert.strictEqual(peer.sequence, 1)
        })

        it('handles alive update with same sequence number', () => {
          peer.handleUpdate({ status: 'alive', sequence: 1 })
          assert.strictEqual(peer.status, 'suspect')
          assert.strictEqual(peer.sequence, 1)
        })

        it('handles alive update with higher sequence number', async () => {
          const promise = new Promise(resolve => peer.once('alive', resolve))
          peer.handleUpdate({ status: 'alive', sequence: 2 })
          assert.strictEqual(peer.status, 'alive')
          assert.strictEqual(peer.sequence, 2)
          await promise
        })
      })

      describe('#handleUpdate(\'suspect\')', () => {
        it('handles suspect update with lower sequence number', () => {
          peer.handleUpdate({ status: 'suspect', sequence: 0 })
          assert.strictEqual(peer.status, 'suspect')
          assert.strictEqual(peer.sequence, 1)
        })

        it('handles alive update with same sequence number', () => {
          peer.handleUpdate({ status: 'suspect', sequence: 1 })
          assert.strictEqual(peer.status, 'suspect')
          assert.strictEqual(peer.sequence, 1)
        })

        it('handles alive update with higher sequence number', () => {
          peer.handleUpdate({ status: 'suspect', sequence: 2 })
          assert.strictEqual(peer.status, 'suspect')
          assert.strictEqual(peer.sequence, 2)
        })
      })

      describe('#handleUpdate(\'down\')', () => {
        it('handles suspect update with lower sequence number', async () => {
          const promise = new Promise(resolve => peer.once('down', resolve))
          peer.handleUpdate({ status: 'down', sequence: 0 })
          assert.strictEqual(peer.status, 'down')
          assert.strictEqual(peer.sequence, 1)
          await promise
        })

        it('handles alive update with same sequence number', async () => {
          const promise = new Promise(resolve => peer.once('down', resolve))
          peer.handleUpdate({ status: 'down', sequence: 1 })
          assert.strictEqual(peer.status, 'down')
          assert.strictEqual(peer.sequence, 1)
          await promise
        })

        it('handles alive update with higher sequence number', async () => {
          const promise = new Promise(resolve => peer.once('down', resolve))
          peer.handleUpdate({ status: 'down', sequence: 2 })
          assert.strictEqual(peer.status, 'down')
          assert.strictEqual(peer.sequence, 2)
          await promise
        })
      })
    })
  })
})
