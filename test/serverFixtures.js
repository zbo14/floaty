'use strict';

const assert    = require('assert');
const { it }    = require('mocha');
const Server    = require('../lib/server');
const sameId    = require('../lib/id');
const newUpdate = require('../lib/update');

const servers = [];

exports.initServer = i => {
  it( 'initializes a server', () => {
    servers[ i ].init( servers );
  });
};

exports.teardownServer = i => {
  it( 'tears down a server', () => {
    servers[ i ].teardown();
  });
};

exports.startServer = i => {
  it( 'starts a server', () => {
    servers[ i ].start();
  });
};

exports.stopServer = i => {
  it( 'stops a server', () => {
    servers[ i ].stop();
  });
};

const getServer = x => {
  return servers.find( server => sameId( server, x ) );
};

exports.createServers = ({ numServers, port, address = 'localhost' }) => {
  it( 'creates servers', () => {
    let server;
    for ( let id = 0; id < numServers; id++ ) {
      server = new Server({ id, port: port + id, address });
      servers.push( server );
    }
  });
};

exports.getsRightUpdates = i => {
  it( 'gets the right updates', () => {
    const server = servers[ i ];
    const limit = server.limit;
    server.updates = [
      { id: 2, sequence: 0, status: 'alive', count: limit - 1 },
      { id: 3, sequence: 4, status: 'down', count: limit - 1 },
      { id: 1, sequence: 5, status: 'alive', count: limit + 1 },
      { id: 4, sequence: 3, status: 'suspect', count: limit - 1 },
      { id: 1, sequence: 2, status: 'suspect', count: limit - 1 },
      { id: 0, sequence: 1, status: 'alive', count: limit },
      { id: 3, sequence: 2, status: 'suspect', count: limit - 1 },
      { id: 0, sequence: 0, status: 'alive', count: limit - 1 }
    ];
    const updates = server.getUpdates();
    assert.deepStrictEqual( updates,  [
      { id: 2, sequence: 0, status: 'alive', count: limit },
      { id: 3, sequence: 4, status: 'down', count: limit },
      { id: 4, sequence: 3, status: 'suspect', count: limit },
      { id: 1, sequence: 2, status: 'suspect', count: limit },
      { id: 3, sequence: 2, status: 'suspect', count: limit },
      { id: 0, sequence: 0, status: 'alive', count: limit }
    ]);
    server.updates = [];
  });
};

exports.sendInvalidMessage = i => {
  it( 'sends invalid message to server', done => {
    const server = servers[ i ];
    server.once( 'error', err => {
      assert.equal( err instanceof Error, true );
      done();
    });
    server.socket.send( '{"a": 1 "b": 2}', server.port, server.address );
  });
};

exports.initServers = () => {
  it( 'initializes servers', () => {
    servers.forEach( server => server.init( servers ) );
  });
};

exports.teardownServers = () => {
  it( 'tears down servers', () => {
    servers.forEach( server => server.teardown() );
  });
};

exports.suspectAlive = i => {
  it( 'finds that suspect is alive', done => {
    const server = servers[ i ];
    const peer = server.randomPeer();
    const nextSequence = peer.sequence + 1;
    peer.once( 'suspect', () => {
      assert.equal( peer.status, 'suspect' );
      server.ping( peer );
    });
    // peer should become "alive" before sequence is incremented
    // because server will handle ack before it handles update
    peer.once( 'sequence', sequence => {
      assert.equal( peer.status, 'alive' );
      assert.equal( sequence, nextSequence );
      done();
    });
    server.handleUpdate( newUpdate( peer, 'suspect' ) );
  });
};

exports.suspectDown = i => {
  it( 'finds that suspect is down', done => {
    const server = servers[ i ];
    const peer = server.randomPeer();
    const otherServer = getServer( peer );
    otherServer.teardown();
    peer.once( 'suspect', () => {
      assert.equal( peer.status, 'suspect' );
      peer.once( 'down', () => {
        assert.equal( peer.status, 'down' );
        otherServer.init( servers );
        done();
      });
      server.ping( peer );
    });
    server.handleUpdate( newUpdate( peer, 'suspect' ) );
  }).timeout( 3000 );
};

exports.ping = i => {
  it( 'pings a random peer', done => {
    const server = servers[ i ];
    const peer = server.randomPeer();
    peer.once( 'ack', () => done() );
    server.ping( peer );
  });
};

exports.pingReq = i => {
  it( 'ping-reqs a random peer and target', done => {
    const server = servers[ i ];
    const peer = server.randomPeer();
    let target = server.randomPeer();
    while ( sameId( peer, target ) ) {
      target = server.randomPeer();
    }
    peer.once( 'ack', () => done() );
    server.pingReq( peer, target );
  });
};

exports.pingFail = i => {
  it( 'fails to ping a peer that is down', done => {
    const server = servers[ i ];
    const peer = server.randomPeer();
    const otherServer = getServer( peer );
    otherServer.teardown();
    peer.once( 'target', () => {
      otherServer.init( servers );
      done();
    });
    server.ping( peer );
  });
};

exports.isAlive = i => {
  it( 'checks that peer is alive', () => {
    const server = servers [ i ];
    let peer;
    for ( let j = 0; j < servers.length; j++ ) {
      if ( i !== j ) {
        peer = servers[ j ].getPeer( server );
        assert.equal( peer.status, 'alive' );
      }
    }
  });
};

exports.isDown = i => {
  it( 'checks that peer is down', () => {
    const server = servers [ i ];
    let peer;
    for ( let j = 0; j < servers.length; j++ ) {
      if ( i !== j ) {
        peer = servers[ j ].getPeer( server );
        assert.equal( peer.status, 'down' );
      }
    }
  });
};

exports.addPeerFail = i => {
  it( 'fails to add peer with same id', () => {
    const server = servers[ i ];
    const result = server.addPeer({
      id: server.id, port: 10101, address: 'localhost'
    });
    assert.equal( result, false );
  });

  it( 'fails to add peer again', () => {
    const server = servers[ i ];
    const peer = server.randomPeer();
    const result = server.addPeer( peer );
    assert.equal( result, false );
  });
};

exports.wait = timeout => {
  it( `waits for ${timeout} millis`, done => {
    setTimeout( done, timeout );
  }).timeout( timeout + 500 );
};

exports.startServers = () => {
  it( 'starts servers', () => {
    servers.forEach( server => server.start() );
  });
};

exports.stopServers = () => {
  it( 'stops servers', () => {
    servers.forEach( server => server.stop() );
  });
};
