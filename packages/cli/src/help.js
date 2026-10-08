'use strict'

const { gray } = require('./colors')
const { EOL } = require('os')
const path = require('path')

const printCommand = command => `⬩ ${command.replace(path.extname(command), '')}`

module.exports = commands => `
Usage
  $ browserless <command> <url> [flags]
  $ browserless exec <file> [flags]

Commands
  ${gray(commands.map(printCommand).join(EOL + '  '))}`
