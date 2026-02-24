#!/usr/bin/env node

'use strict'

const restoreCursor = require('restore-cursor')
const createBrowser = require('browserless')
const beautyError = require('beauty-error')
const { onExit } = require('signal-exit')
const { nestie } = require('nestie')
const path = require('path')
const mri = require('mri')
const fs = require('fs')

const noop = () => {}

const commands = fs.readdirSync(path.resolve(__dirname, 'commands'))

const { _, ...flags } = mri(process.argv.slice(2), {
  boolean: ['headless', 'verbose'],
  default: {
    codeScheme: 'ghcolors',
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

const { verbose, headless, ...opts } = cli.flags

const spinner = verbose ? require('./spinner') : { start: noop, stop: noop, clear: noop }

process.on('SIGINT', () => {
  spinner.stop({ force: true })
  process.exit(130)
})

const run = async () => {
  if (cli.input.length === 0) return cli.showHelp()
  spinner.start()
  const [command, rawUrl] = cli.input
  const url = new URL(rawUrl).toString()
  const fn = require(`./commands/${command}`)
  const launchOpts = { headless }

  if (command === 'capture') {
    const capture = require('@browserless/capture')

    launchOpts.headless = headless === false ? false : 'new'
    launchOpts.ignoreDefaultArgs = ['--disable-extensions']
    launchOpts.args = [
      '--autoplay-policy=no-user-gesture-required',
      '--auto-accept-this-tab-capture',
      '--screen-info={2560x1600 devicePixelRatio=2}',
      `--allowlisted-extension-id=${capture.extensionId}`,
      `--disable-extensions-except=${capture.extensionPath}`,
      `--load-extension=${capture.extensionPath}`
    ]
  }

  const browser = createBrowser(launchOpts)
  onExit(browser.close)
  const browserless = await browser.createContext()
  return fn({ url, browserless, opts: nestie(opts) })
}

run()
  .then(([result, preview = result]) => {
    spinner.stop({ result })
    if (typeof preview === 'string') console.error(preview)
    process.exit()
  })
  .catch(error => {
    spinner.clear()
    restoreCursor()
    console.error(beautyError(error))
    process.exit(1)
  })
