'use strict';

/**
 * @typedef {Object} Update
 * @property {number} count - the number of times the update has been sent.
 * @property {number} id - the id of the peer being updated.
 * @property {number} sequence - the sequence number of the peer being updated.
 * @property {string} status - the updated status.
 */

/**
 * newUpdate
 * @param  {Object} info
 * @param  {number} info.id
 * @param  {number} info.sequence
 * @param  {string} status
 * @return {Update}
 */
const newUpdate = ({ id, sequence }, status ) => ({
  count: 0,
  id,
  sequence,
  status
});

module.exports = newUpdate;
