'use strict'

const pReflect = require('p-reflect')
const del = require('del')

const fkill = require('./fkill')

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

const clean = () => del.sync(['/tmp/core.*', '/tmp/puppeteer_dev_profile*'], { force: true })

const kill = async (pid, { cleanup = false } = {}) => {
  await fkill(pid, { tree: true, force: true, silent: true })
  const deletedPaths = cleanup ? clean() : []
  return { pid, deletedPaths }
}

const destroy = async (browser, opts) => {
  const pid = browser.process().pid
  await pReflect(browser.close())
  return kill(pid, opts)
}

module.exports = { clean, spawn, kill, destroy }
