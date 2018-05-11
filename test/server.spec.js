'use strict';

const { describe } = require('mocha');
const fixtures     = require('./serverFixtures');

describe( 'server', () => {
  fixtures.createServers({ numServers: 5, port: 4000 });
  fixtures.initServers();
  fixtures.sendInvalidMessage( 0 );
  fixtures.addPeerFail( 0 );
  fixtures.getsRightUpdates( 0 );
  fixtures.ping( 1 );
  fixtures.pingReq( 2 );
  fixtures.pingFail( 3 );
  fixtures.suspectAlive( 4 );
  fixtures.suspectDown( 0 );
  fixtures.startServers();
  fixtures.stopServer( 0 );
  fixtures.teardownServer( 0 );
  fixtures.wait( 10000 );
  fixtures.isDown( 0 );
  fixtures.initServer( 0 );
  fixtures.startServer( 0 );
  fixtures.wait( 10000 );
  fixtures.isAlive( 0 );
  fixtures.stopServers();
  fixtures.teardownServers();
});
