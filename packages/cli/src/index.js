#!/usr/bin/env node

'use strict'

const restoreCursor = require('restore-cursor')
const createBrowser = require('browserless')
const beautyError = require('beauty-error')
const { onExit } = require('signal-exit')
const path = require('path')
const mri = require('mri')
const fs = require('fs')

const commands = fs.readdirSync(path.resolve(__dirname, 'commands'))

const { _, ...flags } = mri(process.argv.slice(2), {
  boolean: ['headless', 'verbose'],
  default: {
    codeScheme: 'ghcolors',
    headless: 'new',
    verbose: true
  }
})

const cli = {
  flags,
  input: _,
  showHelp: () => {
    console.log(require('./help')(commands))
    process.exit(0)
  }
}

const { verbose, headless } = cli.flags

const spinner = verbose ? require('./spinner') : { start: () => {}, stop: () => {} }

process.on('SIGINT', () => {
  spinner.stop({ force: true })
  process.exit(1)
})

const run = async () => {
  if (cli.input.length === 0) return cli.showHelp()
  spinner.start()
  const [command, rawUrl] = cli.input
  const url = new URL(rawUrl).toString()
  const fn = require(`./commands/${command}`)
  const browser = createBrowser({ headless })
  onExit(browser.close)
  const browserless = await browser.createContext()
  return fn({ url, browserless, opts: cli.flags })
}

run()
  .then(([result, preview = result]) => {
    spinner.stop({ result })
    if (typeof preview === 'string') console.log(preview)
    process.exit()
  })
  .catch(error => {
    spinner.clear()
    restoreCursor()
    console.error(beautyError(error))
    process.exit(1)
  })
