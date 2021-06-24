#!/usr/bin/env node

'use strict'

const createBrowserless = require('browserless')
const beautyError = require('beauty-error')
const path = require('path')
const fs = require('fs')

const commands = fs.readdirSync(path.resolve(__dirname, 'commands'))

const cli = require('meow')({
  pkg: require('../package.json'),
  help: require('./help')(commands)
})

const { verbose } = cli.flags

const spinner = verbose ? require('./spinner') : { start: () => {}, stop: () => {} }

const run = async () => {
  if (cli.input.length === 0) return cli.showHelp()
  spinner.start()
  const [command, rawUrl] = cli.input
  const url = new URL(rawUrl).toString()
  const fn = require(`./commands/${command}`)

  const browserlessFactory = createBrowserless()
  const browserless = await browserlessFactory.createContext()

  const result = await fn({ url, browserless, opts: cli.flags })

  await browserless.destroyContext()
  await browserlessFactory.close()

  return result
}

run()
  .then(result => {
    const stats = spinner.stop(result)
    if (result) console.log(result)
    if (stats) console.error(`\n${stats}`)
    process.exit()
  })
  .catch(error => {
    spinner.stop()
    console.error(beautyError(error))
    process.exit(1)
  })
