'use strict'

const { styleText } = require('node:util')

const gray = str => styleText('gray', str)

const white = str => styleText('white', str)

const green = str => styleText('green', str)

const red = str => styleText('red', str)

const yellow = str => styleText('yellow', str)

const label = (text, color) => styleText(['inverse', 'bold', color], ` ${text.toUpperCase()} `)

module.exports = { gray, white, green, red, yellow, label }
