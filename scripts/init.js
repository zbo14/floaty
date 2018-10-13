'use strict'

const fs = require('fs')
const path = require('path')
const util = require('util')

const composePath = path.resolve(
  path.join(__dirname, '..', 'docker-compose.yml')
)

const nodesPath = path.resolve(
  path.join(__dirname, '..', 'nodes.json')
)

const writeFile = util.promisify(fs.writeFile)

const node = (port, i) => `
  node${i}:
    container_name: node${i}
    init: true
    build: .
    command: node main.js ${i}
    ports:
      - ${port + i}:${port + i}/udp
`

let dockerCompose = `version: '2.2'

services:`

const init = async config => {
  const nodes = []

  for (let i = 0; i < config.numNodes; i++) {
    nodes.push({
      id: config.id + i,
      port: config.port + i,
      address: `node${i}`
    })

    dockerCompose += node(config.port, i)
  }

  await Promise.all([
    writeFile(
      composePath,
      dockerCompose,
      { encoding: 'utf8' }
    ),

    writeFile(
      nodesPath,
      JSON.stringify(nodes, null, 2),
      { encoding: 'utf8' }
    )
  ])
}

init({ numNodes: 4, id: 100, port: 10000 })

module.exports = init
