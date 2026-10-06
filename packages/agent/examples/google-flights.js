'use strict'

const agent = require('..')
const debug = require('debug-logfmt')('browserless:agent')
const { flat } = require('./util')

const DAYS_AHEAD = 30
const DAY_MS = 24 * 60 * 60 * 1000
const FLIGHT_FIELDS = ['airline', 'departure', 'arrival', 'duration', 'stops', 'price']

const departure = new Date(Date.now() + DAYS_AHEAD * DAY_MS).toLocaleDateString('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric'
})

module.exports = async ({ page, browserless }) => {
  agent(page)

  await browserless.goto(page, {
    url: 'https://www.google.com/travel/flights?hl=en',
    adblock: false
  })
  const consented = await page.goal(
    'If a cookie consent page is shown, scroll down and reject all cookies.'
  )
  if (debug.enabled) debug('reject cookies', flat(await consented()))
  const found = await page.goal(
    `Find one-way flights from Zurich to London on ${departure}, for one adult in economy. Stop when matching flight options are visible.`
  )
  if (debug.enabled) debug('find flights', flat(await found()))

  return page.extract('get the flights listed on the page', {
    flights: { attr: Object.fromEntries(FLIGHT_FIELDS.map(name => [name, { type: 'string' }])) }
  })
}
