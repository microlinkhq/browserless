'use strict'

const arrify = require('arrify')
const pidtree = require('pidtree')
const psList = require('ps-list')
const AggregateError = require('aggregate-error')
const pidFromPort = require('pid-from-port')
const processExists = require('process-exists')

const kill = async (pid, options) => {
  let pids = [pid]
  if (options.tree) pids = await pidtree(pid, { root: true })
  const signal = options.force ? 'SIGKILL' : undefined
  pids.forEach(pid => process.kill(pid, signal))
}

const parseInput = async input => {
  if (typeof input === 'string' && input[0] === ':') {
    return pidFromPort(parseInt(input.slice(1), 10))
  }

  return input
}

const fkill = async (inputs, options = {}) => {
  inputs = arrify(inputs)

  options.tree = options.tree === undefined ? true : options.tree
  options.ignoreCase = options.ignoreCase || process.platform === 'win32'

  const exists = await processExists.all(inputs)

  const errors = []

  const handleKill = async input => {
    try {
      input = await parseInput(input)

      if (input === process.pid) {
        return
      }

      // Handle killall by process name
      if (typeof input === 'string') {
        const processes = await psList()
        const nameRe = new RegExp(`^${input}$`, options.ignoreCase ? 'i' : '')

        const pids = processes.filter(ps => nameRe.test(ps.name)).map(ps => ps.pid)

        if (pids.length === 0) {
          errors.push(`Killing process ${input} failed: Process doesn't exist`)
          return
        }

        await Promise.all(
          pids.map(async pid => {
            if (pid !== process.pid) {
              await kill(pid, options)
            }
          })
        )
        return
      }

      if (!exists.has(input)) {
        errors.push(`Killing process ${input} failed: Process doesn't exist`)
        return
      }

      await kill(input, options)
    } catch (error) {
      errors.push(
        `Killing process ${input} failed: ${error.message
          .replace(/.*\n/, '')
          .replace(/kill: \d+: /, '')
          .trim()}`
      )
    }
  }

  await Promise.all(inputs.map(input => handleKill(input)))

  if (errors.length > 0 && !options.silent) {
    throw new AggregateError(errors)
  }
}

module.exports = fkill
