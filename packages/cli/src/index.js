#!/usr/bin/env node

'use strict'

const createBrowserless = require('browserless')
const beautyError = require('beauty-error')
const darkMode = require('dark-mode')
const path = require('path')
const fs = require('fs')

const commands = fs.readdirSync(path.resolve(__dirname, 'commands'))

const cli = require('meow')({
  pkg: require('../package.json'),
  help: require('./help')(commands),
  flags: {
    headless: {
      type: 'boolean',
      default: process.env.HEADLESS !== undefined ? process.env.HEADLESS : true
    },
    codeScheme: {
      type: 'string',
      default: 'ghcolors'
    }
  }
})

const { verbose, headless } = cli.flags

const spinner = verbose ? require('./spinner') : { start: () => {}, stop: () => {} }

const run = async () => {
  if (cli.input.length === 0) return cli.showHelp()
  spinner.start()
  const [command, rawUrl] = cli.input
  const url = new URL(rawUrl).toString()
  const fn = require(`./commands/${command}`)

  const browserlessFactory = createBrowserless({ headless })
  const browserless = await browserlessFactory.createContext()

  if (cli.flags.codeScheme === 'ghcolors') {
    const isDark = await darkMode.isDark()
    cli.flags.colorScheme = isDark ? 'dark' : 'light'
    cli.flags.styles = isDark
      ? '#screenshot pre{background:#000}#screenshot .token.string{color:#50e3c2}#screenshot .token.number{color:#f81ce5}'
      : '#screenshot pre{background:#fff}#screenshot .token.string{color:#f81ce5}#screenshot .token.number{color:#50e3c2}'
  }

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
