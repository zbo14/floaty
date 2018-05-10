'use strict';

const { createSocket }      = require('dgram');
const EventEmitter          = require('events');
const Peer                  = require('./peer');
const { newUpdate, sameId } = require('./util');

/**
 * Server
 * @extends EventEmitter
 */
class Server extends EventEmitter {
  constructor({ id, port, address }) {
    super();
    this.address = address;
    this.id = id;
    this.port = port;
    this.sequence = 0;
    this.setMaxListeners( Infinity );
  }

  on( eventName, cb ) {
    super.on( eventName, ( ...params ) => setImmediate( cb, ...params ) );
  }

  once( eventName, cb ) {
    super.once( eventName, ( ...params ) => setImmediate( cb, ...params ) );
  }

  openSocket() {
    this.socket = createSocket('udp4');
    this.socket.on( 'message', buf => {
      try {
        const msg = JSON.parse( buf.toString() );
        this.handleMessage( msg );
      } catch ( err ) {
        this.emit( 'error', err );
      }
    });
    this.socket.bind( this.port, this.address );
  }

  setup( peers ) {
    this.nextIndex = 0;
    this.peers = [];
    this.updates = [];
    peers.forEach( peer => this.addPeer( peer ) );
    this.openSocket();
  }

  teardown() {
    this.socket.close();
  }

  start( peers ) {
    this.setup( peers );
    this.interval = setInterval( () => this.startProtocolPeriod(), 1000 );
  }

  stop() {
    clearInterval( this.interval );
    this.teardown();
  }

  // from wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle#The_modern_algorithm
  shufflePeers() {
    let temp;
    for ( let i = 0, j; i < this.peers.length - 1; i++ ) {
      j = i + Math.floor( Math.random() * ( this.peers.length - i ) );
      temp = this.peers[ i ];
      this.peers[ i ] = this.peers[ j ];
      this.peers[ j ] = temp;
    }
  }

  startProtocolPeriod() {
    const peer = this.peers[ this.nextIndex ];
    this.ping( peer );
    if ( ++this.nextIndex === this.peers.length ) {
      this.nextIndex = 0;
      this.shufflePeers();
    }
  }

  randomIndex() {
    return Math.floor( Math.random() * this.peers.length );
  }

  randomPeer() {
    return this.peers[ this.randomIndex() ];
  }

  addPeer( peer ) {
    if ( sameId( peer, this ) || this.hasPeer( peer ) ) {
      return false;
    }
    const target = new Peer({
      id: peer.id,
      port: peer.port,
      address: peer.address,
      server: this
    });
    target.on( 'alive', () => this.addUpdate( target, 'alive' ) );
    target.on( 'down', () => this.addUpdate( target, 'down' ) );
    target.on( 'suspect', () => this.addUpdate( target, 'suspect' ) );
    target.on( 'ping-req', () => {
      let peer = this.randomPeer();
      while ( sameId( peer, target ) ) {
        peer = this.randomPeer();
      }
      this.pingReq( peer, target );
    });
    this.peers.splice( this.randomIndex(), 0, target );
    return true;
  }

  getPeer( x ) {
    return this.peers.find( peer => sameId( peer, x ) );
  }

  hasPeer( x ) {
    return this.getPeer( x ) !== undefined;
  }

  handleMessage({ command, senderId, targetId = null, updates = [] }) {
    const sender = this.getPeer( senderId );
    updates.forEach( update => this.handleUpdate( update ) );
    switch ( command ) {
      case 'ack':
        this.handleAck( sender );
        break;
      case 'ping':
        this.handlePing( sender );
        break;
      case 'ping-req':
        const target = this.getPeer( targetId );
        this.handlePingReq( sender, target );
        break;
    }
  }

  handleAck( sender ) {
    sender.emit('ack');
  }

  handlePing( sender ) {
    this.ack( sender );
  }

  handlePingReq( sender, target ) {
    this.ping( target, false );
    target.once( 'ack', () => this.ack( sender ) );
  }

  handleUpdate( update ) {
    if ( sameId( this, update ) ) {
      if ( update.status === 'suspect' ) {
        this.sequence++;
        this.addUpdate( this, 'alive' );
      }
      return;
    }
    const peer = this.getPeer( update );
    peer.handleUpdate( update );
  }

  get limit() {
    return Math.round( Math.log( this.peers.length + 1 ) * 3 );
  }

  addUpdate( peer, status ) {
    this.updates.push( newUpdate( peer, status ) );
  }

  getUpdates() {
    this.updates = [
      ...this.updates.slice( 0, 6 ).filter( update => {
        return update.count < this.limit;
      }),
      ...this.updates.slice( 6 )
    ];
    for ( let i = 0; i < Math.min( 6, this.updates.length ); i++ ) {
      this.updates[ i ].count++;
    }
    return this.updates.slice( 0, 6 );
  }

  ping( peer, pingReq = true ) {
    peer.ping( this.id, this.getUpdates(), this.socket, pingReq );
  }

  ack( peer ) {
    peer.ack( this.id, this.getUpdates(), this.socket );
  }

  pingReq( peer, target ) {
    peer.pingReq( this.id, target, this.getUpdates(), this.socket );
  }
}

module.exports = Server;
