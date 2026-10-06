'use strict'

const FLIGHT_FIELDS = ['airline', 'departure', 'arrival', 'duration', 'stops', 'price']
const DAYS_AHEAD = 30
const DAY_MS = 24 * 60 * 60 * 1000

const departure = new Date(Date.now() + DAYS_AHEAD * DAY_MS).toLocaleDateString('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric'
})

module.exports = require('./task')({
  name: 'google-flights',
  url: 'https://www.google.com/travel/flights?hl=en',
  navigation: { adblock: false },
  extract: {
    instruction: 'get the flights listed on the page',
    fields: {
      flights: {
        attr: Object.fromEntries(FLIGHT_FIELDS.map(name => [name, { type: 'string' }]))
      }
    }
  },
  goal: `If a cookie consent page appears, scroll down and reject all cookies first. Then find one-way flights from Zurich to London on ${departure}, for one adult in economy. Stop when matching flight options are visible.`
})
