'use strict'

const STATE = Symbol.for('browserless.networkIdle')

/**
 * Puppeteer's `waitForNetworkIdle` starts measuring its idle window when it is
 * called, so a page whose network went quiet before the call still pays the
 * full window. This tracks when the page actually became quiet, from as early
 * as possible, so the window already served can be credited against it.
 *
 * "Quiet" matches Puppeteer's own definition: no more than `concurrency`
 * requests in flight.
 */
const track = (page, { concurrency }) => {
  if (typeof page?.on !== 'function' || typeof page.off !== 'function') return undefined
  if (page[STATE]) return page[STATE]

  const state = { inflight: 0, quietSince: Date.now(), concurrency }

  const onRequest = () => {
    state.inflight++
    if (state.inflight > concurrency) state.quietSince = undefined
  }

  const onSettled = () => {
    if (state.inflight > 0) state.inflight--
    if (state.inflight <= concurrency && state.quietSince === undefined) {
      state.quietSince = Date.now()
    }
  }

  page.on('request', onRequest)
  page.on('requestfinished', onSettled)
  page.on('requestfailed', onSettled)

  state.detach = () => {
    page.off('request', onRequest)
    page.off('requestfinished', onSettled)
    page.off('requestfailed', onSettled)
    delete page[STATE]
  }

  page[STATE] = state
  return state
}

/**
 * How long the page has already been quiet, in milliseconds. Zero when the
 * page is busy or when no tracker was attached, which makes every caller fall
 * back to waiting the full window.
 */
const quietFor = page => {
  const state = page?.[STATE]
  if (!state || state.quietSince === undefined) return 0
  return Date.now() - state.quietSince
}

const inflight = page => page?.[STATE]?.inflight

module.exports = { track, quietFor, inflight, STATE }
