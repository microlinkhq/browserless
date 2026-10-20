'use strict'

const fs = require('node:fs')

const botdSource = fs.readFileSync(require.resolve('@fingerprintjs/botd'), 'utf8')

/**
 * @typedef {Object} BotdDetector
 * @property {string} name
 * @property {boolean} bot
 * @property {string|null} kind
 */

/**
 * @typedef {Object} BotdReport
 * @property {boolean} bot
 * @property {string|null} kind
 * @property {BotdDetector[]} detectors
 * @property {string[]} trapped
 */

const detectorFrom = (name, detection) => {
  if (detection === null || typeof detection !== 'object' || typeof detection.bot !== 'boolean') {
    throw new Error('aggregate disagrees with the detector list')
  }
  if (!detection.bot) {
    if (detection.botKind != null) throw new Error('aggregate disagrees with the detector list')
    return { name, bot: false, kind: null }
  }
  if (typeof detection.botKind !== 'string' || detection.botKind === '') {
    throw new Error('a hit has no kind')
  }
  return { name, bot: true, kind: detection.botKind }
}

const parseReport = payload => {
  const detections = payload && payload.detections
  if (detections === null || typeof detections !== 'object' || Array.isArray(detections)) {
    throw new Error('detections is empty')
  }

  const detectors = Object.entries(detections).map(([name, detection]) =>
    detectorFrom(name, detection)
  )
  if (detectors.length === 0) throw new Error('detections is empty')

  const bot = payload.bot
  const kind = payload.kind
  const flagged = detectors.some(detector => detector.bot)
  if (typeof bot !== 'boolean' || bot !== flagged) {
    throw new Error('aggregate disagrees with the detector list')
  }
  if (bot) {
    if (typeof kind !== 'string' || kind === '') throw new Error('a hit has no kind')
  } else if (kind !== null) {
    throw new Error('aggregate disagrees with the detector list')
  }

  const trapped = payload.trapped
  if (!Array.isArray(trapped) || trapped.some(name => typeof name !== 'string' || name === '')) {
    throw new Error('trapped is not an array of non-empty strings')
  }

  return {
    bot,
    kind: bot ? kind : null,
    detectors,
    trapped: trapped.slice()
  }
}

const collect = async source => {
  const module = { exports: {} }
  // The BotD build is CommonJS. This runs it in the page without adding a script tag.
  // eslint-disable-next-line no-new-func
  new Function('exports', 'module', source)(module.exports, module)
  const agent = await module.exports.load({ monitoring: false })
  const verdict = agent.detect()
  const detections = agent.getDetections()
  const components = agent.getComponents()
  const trapped = []
  for (const name of Object.keys(components)) {
    const state = components[name].state
    // Success is 0. Undefined (-1) is an absent value, which is what a browser
    // reports for window.process. detectProcess already returns false for that.
    // Any other state is a collect that did not finish.
    if (state !== 0 && state !== -1) trapped.push(name)
  }
  return {
    bot: verdict.bot,
    kind: verdict.bot ? verdict.botKind : null,
    detections,
    trapped
  }
}

/**
 * Run the installed BotD build in the page main world.
 * A collection failure stays in trapped and does not flip bot.
 *
 * @param {import('puppeteer').Page} page
 * @returns {Promise<BotdReport>}
 */
const check = async page => parseReport(await page.evaluate(collect, botdSource))

module.exports = check
