'use strict';

const assert = require('assert');
const { it } = require('mocha');

exports.ack = ( peer, socket ) => {
  it( 'acks the peer', done => {
    socket.once( 'message', buf => {
      const msg = JSON.parse( buf.toString() );
      assert.deepStrictEqual( msg, {
        command: 'ack',
        senderId: 0,
        updates: []
      });
      done();
    });
    peer.ack( 0, [], socket );
  });
};

exports.wake = peer => {
  it( 'wakes the peer', done => {
    peer.once( 'alive', () => {
      assert.equal( peer.status, 'alive' );
      done();
    });
    peer.alive();
  });
};

exports.pingSuccess = ( peer, socket ) => {
  it( 'pings the peer', done => {
    socket.once( 'message', buf => {
      const msg = JSON.parse( buf.toString() );
      assert.deepStrictEqual( msg, {
        command: 'ping',
        senderId: 0,
        updates: []
      });
      peer.emit('ack');
    });
    peer.once( 'ack', done );
    peer.ping( 0, [], socket );
  });
};

exports.pingReqSuccess = ( peer, target, socket ) => {
  it( 'ping-reqs the peer', done => {
    socket.once( 'message', buf => {
      const msg = JSON.parse( buf.toString() );
      assert.deepStrictEqual( msg, {
        command: 'ping-req',
        senderId: 0,
        targetId: target.id,
        updates: []
      });
      peer.emit('ack');
    });
    peer.once( 'ack', () => {
      assert.equal( target.status, 'alive' );
      done();
    });
    peer.pingReq( 0, target, [], socket );
  });
};

exports.pingReqFail = ( peer, target, socket ) => {
  it( 'fails to ping-req the peer', done => {
    socket.once( 'message', buf => {
      const msg = JSON.parse( buf.toString() );
      assert.deepStrictEqual( msg, {
        command: 'ping-req',
        senderId: 0,
        targetId: target.id,
        updates: []
      });
    });
    target.once( 'suspect', () => {
      assert.equal( target.status, 'suspect' );
      done();
    });
    peer.pingReq( 0, target, [], socket );
  });
};

exports.pingFail = ( peer, socket ) => {
  it( 'fails to ping the peer', done => {
    socket.once( 'message', buf => {
      const msg = JSON.parse( buf.toString() );
      assert.deepStrictEqual( msg, {
        command: 'ping',
        senderId: 0,
        updates: []
      });
    });
    peer.once( 'ping-req', done );
    peer.ping( 0, [], socket );
  });
};

exports.suspectSuccess = peer => {
  it( 'suspects the peer', done => {
    peer.once( 'suspect', () => {
      assert.equal( peer.status, 'suspect' );
      peer.once( 'down', () => {
        assert.equal( peer.status, 'down' );
        done();
      });
    });
    peer.suspect();
  });
};

exports.suspectFail = peer => {
  it( 'fails to suspect the peer', done => {
    peer.once( 'suspect', () => {
      assert.equal( peer.status, 'suspect' );
      peer.once( 'alive', () => {
        assert.equal( peer.status, 'alive' );
        done();
      });
      peer.emit('ack');
    });
    peer.suspect();
  });
};

exports.updateSuccess = ( peer, { sequence, status }) => {
  it( `successfully updates the peer to "${status}"`, done => {
    peer.once( `${status}`, () => {
      assert.equal( peer.status, status );
      done();
    });
    peer.handleUpdate({ sequence, status });
  });
};

exports.updateFail = ( peer, { sequence, status }) => {
  it( `fails to update the peer to "${status}"`, () => {
    const statusBefore = peer.status;
    peer.handleUpdate({ sequence, status });
    assert.equal( peer.status, statusBefore );
  });
};
