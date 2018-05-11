'use strict';

/**
 * Peer
 */
class Peer {
  /**
   * constructor
   * @param {Object} info
   * @param {string} info.address
   * @param {number} info.id
   * @param {number} info.port
   * @param {Server} server
   */
  constructor({ id, port, address }, server ) {
    this.address = address;
    this.id = id;
    this.port = port;
    this.sequence = 0;
    this.server = server;
    this.status = 'alive';
    this.on( 'ping', () => this.alive() );
    this.on( 'ping-req', () => this.alive() );
    this.on( 'ack', () => this.alive() );
  }

  update( status ) {
    if ( this.status !== status ) {
      this.emit( this.status = status );
    }
  }

  alive() {
    this.update('alive');
  }

  down() {
    this.update('down');
  }

  emit( eventName, ...params ) {
    this.server.emit( `${eventName}:${this.id}`, ...params );
  }

  on( eventName, cb ) {
    this.server.on( `${eventName}:${this.id}`, cb );
  }

  once( eventName, cb ) {
    this.server.once( `${eventName}:${this.id}`, cb );
  }

  sendTo( msg, socket ) {
    socket.send( JSON.stringify( msg ), this.port, this.address );
  }

  ping( senderId, updates, socket, pingReq = true ) {
    const msg = { command: 'ping', senderId, updates };
    this.sendTo( msg, socket );
    if ( pingReq ) {
      const timeout = setTimeout( () => this.emit('target'), 1000 );
      this.once( 'ack', () => clearTimeout( timeout ) );
    }
  }

  pingReq( senderId, target, updates, socket ) {
    const msg = { command: 'ping-req', senderId, targetId: target.id, updates };
    this.sendTo( msg, socket );
    const timeout = setTimeout( () => target.suspect(), 1000 );
    this.once( 'ack', () => clearTimeout( timeout ) );
  }

  ack( senderId, updates, socket ) {
    const msg = { command: 'ack', senderId, updates };
    this.sendTo( msg, socket );
  }

  suspect() {
    const timeout = setTimeout( () => this.down(), 1000 );
    this.once( 'alive', () => clearTimeout( timeout ) );
    this.update('suspect');
  }

  handleUpdate({ sequence, status }) {
    const mySequence = this.sequence;
    if ( sequence > mySequence ) {
      this.emit( 'sequence', this.sequence = sequence );
    }
    switch ( status ) {
      case 'alive':
        if ( this.status === 'suspect' && sequence > mySequence ) {
          this.alive();
        }
        break;
      case 'down':
        if ( this.status !== 'down' ) {
          this.down();
        }
        break;
      case 'suspect':
        if ( this.status === 'alive' && sequence >= mySequence ) {
          this.suspect();
        }
        break;
    }
  }
}

module.exports = Peer;
