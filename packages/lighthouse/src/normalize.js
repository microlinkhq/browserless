'use strict'

const { toNumber, get, isEmpty, pick } = require('lodash')
const prettyMs = require('pretty-ms')

const PERCEPTION = {
  'first-contentful-paint': duration => {
    if (duration <= 2000) return 'fast'
    if (duration <= 4000) return 'moderate'
    return 'slow'
  },
  'first-meaningful-paint': duration => {
    if (duration <= 2000) return 'fast'
    if (duration <= 4000) return 'moderate'
    return 'slow'
  },
  'speed-index': duration => {
    if (duration <= 4300) return 'fast'
    if (duration <= 5800) return 'moderate'
    return 'slow'
  },
  'first-cpu-idle': duration => {
    if (duration <= 4700) return 'fast'
    if (duration <= 6500) return 'moderate'
    return 'slow'
  },
  interactive: duration => {
    if (duration <= 5200) return 'fast'
    if (duration <= 7300) return 'moderate'
    return 'slow'
  }
}

const PERCEPTIONES_KEYS = Object.keys(PERCEPTION)

const getPerception = ({ id, duration }) =>
  PERCEPTIONES_KEYS.includes(id) ? { perception: PERCEPTION[id](duration) } : undefined

const getDuration = ({ numericValue: duration }) =>
  duration ? { duration, duration_pretty: prettyMs(duration) } : undefined

const getScore = ({ score }) => (score ? { score: toNumber((score * 100).toFixed(0)) } : undefined)

const getDetails = ({ details }) =>
  !isEmpty(get(details, 'items')) ? { details: pick(details, ['heading', 'items']) } : undefined

const getInfo = audit => pick(audit, ['title', 'description'])

module.exports = {
  getDetails,
  getDuration,
  getInfo,
  getScore,
  getPerception
}
