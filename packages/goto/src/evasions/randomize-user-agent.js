'use strict'

const uniqueRandomArray = require('unique-random-array')
const userAgents = require('top-user-agents')

const randomUserAgent = uniqueRandomArray(userAgents)

module.exports = page => page.setUserAgent(randomUserAgent())
