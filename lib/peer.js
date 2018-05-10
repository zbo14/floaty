'use strict';

/**
 * @typedef {Object} Message
 * @property {string} command - the message command.
 * @property {number} senderId - the id of the server that sent the message.
 * @property {number} [targetId] - the id of the target peer in a ping-req.
 * @property {Update[]} [updates] - the updates piggybacked on the message.
 */

/**
 * @typedef {Object} Update
 * @property {number} [count] - how many times the update has been disseminated.
 * @property {number} id - the id of the peer being updated.
 * @property {number} sequence - the sequence number of the peer being updated.
 * @property {string} status - the updated status.
 */

/**
 * Peer
 */
class Peer {
  constructor({ id, port, address, server }) {
    this.address = address;
    this.id = id;
    this.port = port;
    this.sequence = 0;
    this.server = server;
    this.status = 'alive';
    this.on( 'ack', () => this.alive() );
  }

  update( status ) {
    this.emit( this.status = status );
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
      const timeout = setTimeout( () => this.emit('ping-req'), 1000 );
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
