'use strict';

const { describe }     = require('mocha');
const { createSocket } = require('dgram');
const Peer             = require('../lib/peer');
const EventEmitter     = require('events');
const fixtures         = require('./peerFixtures');

describe( 'peer', () => {
  const server = new EventEmitter();
  const peer = new Peer({ id: 1, port: 3001, address: 'localhost' }, server );
  const target = new Peer({ id: 2, port: 3002, address: 'localhost' }, server );
  const socket = createSocket('udp4');
  socket.bind( peer.port, peer.address );
  socket.on( 'error', err => {
    throw err;
  });
  fixtures.suspectFail( peer );
  fixtures.suspectSuccess( peer );
  fixtures.wake( peer );
  fixtures.updateSuccess( peer, { status: 'suspect', sequence: 0 });
  fixtures.updateFail( peer, { status: 'alive', sequence: 0 });
  fixtures.updateSuccess( peer, { status: 'alive', sequence: 1 });
  fixtures.updateFail( peer, { status: 'suspect', sequence: 0 });
  fixtures.updateSuccess( peer, { status: 'down', sequence: 0 });
  fixtures.wake( peer );
  fixtures.pingSuccess( peer, socket );
  fixtures.pingFail( peer, socket );
  fixtures.pingReqSuccess( peer, target, socket );
  fixtures.pingReqFail( peer, target, socket );
  fixtures.ack( peer, socket );
});
