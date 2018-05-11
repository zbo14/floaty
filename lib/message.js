'use strict';

/**
 * @typedef {Object} Message
 * @property {string} command - the message command.
 * @property {number} senderId - the id of the server that sent the message.
 * @property {number} [targetId] - the id of the target peer in a ping-req.
 * @property {Update[]} [updates] - the updates piggybacked on the message.
 */
