'use strict'

const statuses = [
  'alive',
  'down',
  'suspect'
]

const randomStatus = () => statuses[Math.floor(Math.random() * statuses.length)]
const randomSequence = () => Math.round(Math.random() * 10)
const randomCount = limit => Math.round(Math.random() * limit * 2)

module.exports = ({ id, numUpdates, limit }) => {
  const updates = []

  for (let i = id; i < id + numUpdates; i++) {
    updates.push({
      id: i,
      status: randomStatus(),
      sequence: randomSequence(),
      count: randomCount(limit)
    })
  }

  return updates
}
