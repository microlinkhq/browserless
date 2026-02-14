'use strict'

const fs = require('fs')
const path = require('path')
const createBrowserless = require('browserless')

const urls = [
  'https://as.com/',
  'https://live.deutsche-boerse.com/',
  'https://stackoverflow.com/',
  'https://www.bonilista.com/',
  'https://www.cookiebot.com/',
  'https://www.digitalocean.com/',
  'https://www.eltiempo.com/',
  'https://www.ft.com/',
  'https://www.hetzner.com/',
  'https://www.miltoneducation.com',
  'https://www.publico.es/',
  'https://www.sport.es/es/'
]

const takeScreenshot = async ({ url, browserless, withAdblock }) => {
  const { screenshot, destroyContext } = await browserless.createContext()
  const label = url.replace(/https?:\/\//, '').replace(/\W+/g, '_')
  let screenshotPath = path.join(outDir, `${label}.png`)
  screenshotPath = withAdblock
    ? screenshotPath.replace('.png', '-adblock.png')
    : screenshotPath.replace('.png', '-no-adblock.png')
  const start = Date.now()
  await screenshot(url, { path: screenshotPath, adblock: withAdblock, waitForTimeout: 1500 })
  const responseTime = Date.now() - start
  await destroyContext()

  return {
    url,
    screenshotPath,
    responseTime
  }
}

const outDir = path.join(__dirname, 'adblock-benchmark-results')
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir)

async function bench () {
  const browserless = await createBrowserless()

  // Use a map to group results by url and screenshotPath
  const resultsMap = new Map()

  for (const withAdblock of [true, false]) {
    for (const url of urls) {
      const data = await takeScreenshot({ url, browserless, withAdblock })
      const key = `${data.url}|${data.screenshotPath.replace(/-(adblock|no-adblock)\.png$/, '')}`
      let entry = resultsMap.get(key)
      if (!entry) {
        entry = {
          url: data.url,
          screenshotPath: data.screenshotPath.replace(
            /-(adblock|no-adblock)\.png$/,
            '-adblock.png'
          ),
          responseTime: {}
        }
        resultsMap.set(key, entry)
      }
      entry.responseTime[withAdblock ? 'adblock' : 'no-adblock'] = data.responseTime
      // Optionally, update screenshotPath for adblock/no-adblock if you want both paths
      // entry[`screenshotPath_${withAdblock ? 'adblock' : 'no_adblock'}`] = data.screenshotPath
      console.log(
        `Done: ${url} (${withAdblock ? 'adblock' : 'no-adblock'}: ${data.responseTime}ms)`
      )
    }
  }

  await browserless.close()

  const results = Array.from(resultsMap.values())
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2))
  console.log('Benchmark complete. Results saved to', outDir)
}

bench()
  .then(() => {
    process.exit(0)
  })
  .catch(err => {
    console.error('Error during benchmark:', err)
    process.exit(1)
  })
