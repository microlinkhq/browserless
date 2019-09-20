'use strict'

const beautyError = require('beauty-error')
const procStats = require('process-stats')
const { URL } = require('url')
const meow = require('meow')
const ora = require('ora')

const cli = meow()

module.exports = async fn => {
  const spinner = ora().start()
  try {
    const url = new URL(cli.input[0]).toString()
    const output = await fn(url, cli.flags)

    spinner.stop()

    if (output) console.log(output)

    if (!cli.flags.quiet) {
      const { cpu, uptime, memUsed } = procStats()
      console.log()
      console.log(`  time   : ${uptime.pretty}`)
      console.log(`  memory : ${memUsed.pretty}`)
      console.log(`  cpu    : ${cpu}`)
    }

    process.exit()
  } catch (err) {
    spinner.stop()
    console.error(beautyError(err))
    process.exit(1)
  }
}
