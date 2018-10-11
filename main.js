'use strict'

const Server = require('./lib/server')
const nodes = require('./nodes')

const run = async () => {
  const server = new Server({
    ...nodes[process.argv[2]],
    address: '0.0.0.0'
  })

  server.once('error', async err => {
    console.error(err)
    await server.stop()
    server.teardown()
    process.exit(1)
  })

  await server.setup(nodes)
  await server.start()
}

run()
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
