'use strict'

const { gray } = require('kleur')
const { EOL } = require('os')
const path = require('path')

const printCommand = command => `⬩ ${command.replace(path.extname(command), '')}`

module.exports = commands => `
Usage
  $ browserless <command> <url> [flags]

Commands
  ${gray(commands.map(printCommand).join(EOL + '  '))}`
