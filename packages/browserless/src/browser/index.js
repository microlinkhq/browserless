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

const clean = async () =>
  del(['/tmp/core.*', '/tmp/puppeteer_dev_profile*'], {
    force: true
  })

const kill = async (pid, { cleanTmp = false } = {}) => {
  await fkill(pid, { tree: true, force: true, silent: true })
  const deletedPaths = cleanTmp ? await clean() : []
  return { pid, deletedPaths }
}

const destroy = async browser => {
  const pid = browser.process().pid
  await browser.close()
  return kill(pid)
}

module.exports = { clean, spawn, kill, destroy }
