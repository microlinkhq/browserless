#!/usr/bin/env node

'use strict'

const beautyError = require('beauty-error')
const path = require('path')
const fs = require('fs')

const commands = fs.readdirSync(path.resolve(__dirname, 'commands'))

const cli = require('meow')({
  pkg: require('../package.json'),
  help: require('./help')(commands)
})

const spinner = require('./spinner')

const run = async () => {
  if (cli.input.length === 0) return cli.showHelp()
  spinner.start()
  const [command, rawUrl] = cli.input
  const url = new URL(rawUrl).toString()
  const fn = require(`./commands/${command}`)
  return fn(url, cli.flags)
}

run()
  .then(result => {
    const stats = spinner.stop(result)
    if (result) console.log(result)
    console.error(`\n${stats}`)
    process.exit()
  })
  .catch(error => {
    spinner.stop()
    console.error(beautyError(error))
    process.exit(1)
  })
