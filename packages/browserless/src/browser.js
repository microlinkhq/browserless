'use strict'

const debug = require('debug-logfmt')('browserless')
const pReflect = require('p-reflect')
const pidtree = require('pidtree')

const kill = async (pid, { silent = true, signal = 'SIGKILL' } = {}) => {
  const { isRejected, value: pids = [], reason } = await pReflect(pidtree(pid, { root: true }))
  if (isRejected && !silent) throw reason
  pids.forEach(pid => {
    try {
      process.kill(pid, signal)
    } catch (err) {
      if (!silent) throw err
    }
  })
}

const spawn = (puppeteer, launchOpts) =>
  puppeteer.launch({
    ignoreHTTPSErrors: true,
    args: [
      '--disable-notifications',
      '--disable-offer-store-unmasked-wallet-cards',
      '--disable-offer-upload-credit-cards',
      '--disable-setuid-sandbox',
      '--enable-async-dns',
      '--enable-simple-cache-backend',
      '--enable-tcp-fast-open',
      '--media-cache-size=33554432',
      '--no-default-browser-check',
      '--no-pings',
      '--no-sandbox',
      '--no-zygote',
      '--prerender-from-omnibox=disabled'
    ],
    ...launchOpts
  })

const destroy = async (browser, opts) => {
  const pid = browser.process().pid
  debug('destroy', { pid })
  await kill(pid, opts)
  return { pid }
}

module.exports = { spawn, destroy }
