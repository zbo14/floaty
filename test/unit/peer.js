'use strict'

/* eslint-env mocha */

const assert = require('assert')
const lolex = require('lolex')
const Peer = require('../../lib/peer')
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

  describe('#ping()', () => {
    it('mocks ping that doesn\'t receive ack', async () => {
      const promise = new Promise(resolve => peer.once('target', resolve))
      const msg = await peer.ping()

      assert.deepStrictEqual(msg, {
        command: 'ping',
        sender_id: 1,
        updates
      })

      clock.tick(2e3)

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
        target_address: '1.2.3.4',
        target_id: 5,
        target_port: 9999,
        updates
      })

      peer.emit('ack')
    })

    it('mocks pingReq that receives ack from target', async () => {
      const msg = await peer.pingReq(target)

      assert.deepStrictEqual(msg, {
        command: 'ping-req',
        sender_id: 1,
        target_address: '1.2.3.4',
        target_id: 5,
        target_port: 9999,
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
        target_address: '1.2.3.4',
        target_id: 5,
        target_port: 9999,
        updates
      })

      clock.tick(2e3)

      await promise
    })
  })

  describe('#alive()', () => {
    describe('#status:suspect', () => {
      beforeEach(() => {
        peer.status = 'suspect'
      })

      it('updates suspect peer when it hears ack', () => {
        peer.emit('ack')
        assert.strictEqual(peer.status, 'alive')
      })

      it('updates suspect peer when it hears ping', () => {
        peer.emit('ping')
        assert.strictEqual(peer.status, 'alive')
      })

      it('updates suspect peer when it hears ping-req', () => {
        peer.emit('ping-req')
        assert.strictEqual(peer.status, 'alive')
      })

      it('updates suspect peer when it hears event', () => {
        peer.emit('event')
        assert.strictEqual(peer.status, 'alive')
      })

      it('updates suspect peer when it hears event-req', () => {
        peer.emit('event-req')
        assert.strictEqual(peer.status, 'alive')
      })
    })

    describe('#status:faulty', () => {
      beforeEach(() => {
        peer.status = 'faulty'
      })

      it('updates faulty peer when it hears ack', () => {
        peer.emit('ack')
        assert.strictEqual(peer.status, 'alive')
      })

      it('updates faulty peer when it hears ping', () => {
        peer.emit('ping')
        assert.strictEqual(peer.status, 'alive')
      })

      it('updates faulty peer when it hears ping-req', () => {
        peer.emit('ping-req')
        assert.strictEqual(peer.status, 'alive')
      })

      it('updates suspect peer when it hears event', () => {
        peer.emit('event')
        assert.strictEqual(peer.status, 'alive')
      })

      it('updates suspect peer when it hears event-req', () => {
        peer.emit('event-req')
        assert.strictEqual(peer.status, 'alive')
      })
    })
  })

  describe('#suspect()', () => {
    it('fails to suspect already suspect peer', () => {
      peer.status = 'suspect'
      peer.suspect()
      clock.tick(2e3)
      assert.strictEqual(peer.status, 'suspect')
    })

    it('fails to suspect faulty peer', () => {
      peer.status = 'faulty'
      peer.suspect()
      clock.tick(2e3)
      assert.strictEqual(peer.status, 'faulty')
    })

    it('suspects and then marks peer faulty', async () => {
      const promise1 = new Promise(resolve => peer.once('suspect', resolve))
      const promise2 = new Promise(resolve => peer.once('faulty', resolve))
      peer.suspect()
      await promise1
      clock.tick(2e3)
      await promise2
      assert.strictEqual(peer.status, 'faulty')
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

  describe('#faulty()', () => {
    beforeEach(() => {
      peer.sequence = 1
      peer.status = 'alive'
    })

    it('updates peer to faulty', () => {
      peer.lastFaulty = 0
      peer.faulty()
      assert.strictEqual(peer.status, 'faulty')
    })

    it('fails to update peer to faulty', () => {
      peer.lastFaulty = 1
      peer.faulty()
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

      describe('#handleUpdate(\'faulty\')', () => {
        it('handles suspect update with lower sequence number', async () => {
          const promise = new Promise(resolve => peer.once('faulty', resolve))
          peer.handleUpdate({ status: 'faulty', sequence: 0 })
          assert.strictEqual(peer.status, 'faulty')
          assert.strictEqual(peer.sequence, 1)
          await promise
        })

        it('handles alive update with same sequence number', async () => {
          const promise = new Promise(resolve => peer.once('faulty', resolve))
          peer.handleUpdate({ status: 'faulty', sequence: 1 })
          assert.strictEqual(peer.status, 'faulty')
          assert.strictEqual(peer.sequence, 1)
          await promise
        })

        it('handles alive update with higher sequence number', async () => {
          const promise = new Promise(resolve => peer.once('faulty', resolve))
          peer.handleUpdate({ status: 'faulty', sequence: 2 })
          assert.strictEqual(peer.status, 'faulty')
          assert.strictEqual(peer.sequence, 2)
          await promise
        })
      })
    })

    describe('#status:faulty', () => {
      beforeEach(() => {
        peer.status = 'faulty'
        peer.sequence = 1
      })

      describe('#handleUpdate(\'alive\')', () => {
        it('handles alive update with lower sequence number', () => {
          peer.handleUpdate({ status: 'alive', sequence: 0 })
          assert.strictEqual(peer.status, 'faulty')
          assert.strictEqual(peer.sequence, 1)
        })

        it('handles alive update with same sequence number', () => {
          peer.handleUpdate({ status: 'alive', sequence: 1 })
          assert.strictEqual(peer.status, 'faulty')
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
          assert.strictEqual(peer.status, 'faulty')
          assert.strictEqual(peer.sequence, 1)
        })

        it('handles alive update with same sequence number', () => {
          peer.handleUpdate({ status: 'suspect', sequence: 1 })
          assert.strictEqual(peer.status, 'faulty')
          assert.strictEqual(peer.sequence, 1)
        })

        it('handles alive update with higher sequence number', () => {
          peer.handleUpdate({ status: 'suspect', sequence: 2 })
          assert.strictEqual(peer.status, 'faulty')
          assert.strictEqual(peer.sequence, 2)
        })
      })

      describe('#handleUpdate(\'faulty\')', () => {
        it('handles suspect update with lower sequence number', () => {
          peer.handleUpdate({ status: 'faulty', sequence: 0 })
          assert.strictEqual(peer.status, 'faulty')
          assert.strictEqual(peer.sequence, 1)
        })

        it('handles alive update with same sequence number', async () => {
          peer.handleUpdate({ status: 'faulty', sequence: 1 })
          assert.strictEqual(peer.status, 'faulty')
          assert.strictEqual(peer.sequence, 1)
        })

        it('handles alive update with higher sequence number', async () => {
          peer.handleUpdate({ status: 'faulty', sequence: 2 })
          assert.strictEqual(peer.status, 'faulty')
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

      describe('#handleUpdate(\'faulty\')', () => {
        it('handles suspect update with lower sequence number', async () => {
          const promise = new Promise(resolve => peer.once('faulty', resolve))
          peer.handleUpdate({ status: 'faulty', sequence: 0 })
          assert.strictEqual(peer.status, 'faulty')
          assert.strictEqual(peer.sequence, 1)
          await promise
        })

        it('handles alive update with same sequence number', async () => {
          const promise = new Promise(resolve => peer.once('faulty', resolve))
          peer.handleUpdate({ status: 'faulty', sequence: 1 })
          assert.strictEqual(peer.status, 'faulty')
          assert.strictEqual(peer.sequence, 1)
          await promise
        })

        it('handles alive update with higher sequence number', async () => {
          const promise = new Promise(resolve => peer.once('faulty', resolve))
          peer.handleUpdate({ status: 'faulty', sequence: 2 })
          assert.strictEqual(peer.status, 'faulty')
          assert.strictEqual(peer.sequence, 2)
          await promise
        })
      })
    })
  })
})
