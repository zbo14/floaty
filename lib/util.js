'use strict';

const getId = x => {
  if ( typeof x === 'number' ) {
    return x;
  }
  return x.id;
};

exports.newUpdate = ( x, status ) => ({
  id: x.id,
  sequence: x.sequence,
  status,
  count: 0
});

exports.sameId = ( x, y ) => {
  return getId( x ) === getId( y );
};
