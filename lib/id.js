'use strict';

const getId = x => {
  if ( typeof x === 'number' ) {
    return x;
  }
  return x.id;
};

/**
 * sameId
 * @param  {Object} x
 * @param  {Object} y
 * @return {boolean}
 */

const sameId = ( x, y ) => {
  return getId( x ) === getId( y );
};

module.exports = sameId;
