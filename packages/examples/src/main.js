'use strict'

const beautyError = require('beauty-error')
const prettyBytes = require('pretty-bytes')
const procStats = require('process-stats')()
const isBuffer = require('is-buffer')
const termImg = require('term-img')
const { URL } = require('url')
const meow = require('meow')
const ora = require('ora')

const cli = meow()

module.exports = async fn => {
  const spinner = ora().start()
  try {
    const url = new URL(cli.input[0]).toString()
    const { output, isImage } = await fn(url, cli.flags)

    spinner.stop()

    if (output) {
      if (isImage) [].concat(output).forEach(termImg)
      else console.log(output)
    }

    const { cpu, uptime, memUsed } = procStats()

    console.log()

    if (isBuffer(output)) {
      console.log(`  size   : ${prettyBytes(output.byteLength)}`)
    }

    console.log(`  time   : ${uptime.pretty}`)
    console.log(`  memory : ${memUsed.pretty}`)
    console.log(`  cpu    : ${cpu}`)

    process.exit()
  } catch (err) {
    spinner.stop()
    console.error(beautyError(err))
    process.exit(1)
  }
}
