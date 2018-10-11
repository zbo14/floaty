'use strict'

module.exports = ({ id, port, numPeers }) => {
  const peers = []

  for (let i = id; i < id + numPeers; i++) {
    peers.push({
      id: i,
      port: port + i,
      address: '127.0.0.1'
    })
  }

  return peers
}
