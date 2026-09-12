'use strict'

const { runServer, getBrowserContext, getBrowserWSEndpoint } = require('@browserless/test')
const puppeteer = require('puppeteer')
const test = require('ava')

test('setup `scripts`', async t => {
  const browserless = await getBrowserContext(t)

  const getVersion = browserless.evaluate(async page => page.evaluate('jQuery.fn.jquery'))

  const version = await getVersion('https://github.com', {
    scripts: ['https://code.jquery.com/jquery-3.5.0.min.js']
  })

  t.is(version, '3.5.0')
})

test('setup `modules`', async t => {
  const browserless = await getBrowserContext(t)

  const getVersion = browserless.evaluate(async page => page.evaluate('jQuery.fn.jquery'))

  const version = await getVersion('https://github.com', {
    modules: ['https://code.jquery.com/jquery-3.5.0.min.js']
  })

  t.is(version, '3.5.0')
})

test('setup `styles`', async t => {
  const browserless = await getBrowserContext(t)

  const getStyle = browserless.evaluate(async page =>
    page.evaluate('window.getComputedStyle(document.body).fontFamily')
  )

  const style = await getStyle('https://github.com', {
    styles: ['https://cdn.jsdelivr.net/npm/bootstrap@3.4.1/dist/css/bootstrap.min.css']
  })

  t.is(style, '"Helvetica Neue", Helvetica, Arial, sans-serif')
})

test('handle page disconnections', async t => {
  t.plan(1)
  const browserless = await getBrowserContext(t, { retry: 0 })
  const onPageRequest = req => {
    console.log('req.url', req.url)
  }
  const intercept = browserless.withPage((page, goto) => async url => {
    await page.close()

    const result = await goto(page, {
      url,
      onPageRequest,
      abortTypes: ['image', 'stylesheet', 'font']
    })

    t.deepEqual(Object.keys(result), ['response', 'device', 'error'])
  })

  await intercept('chrome://version')
})

test('waitUntil auto waits for delayed content', async t => {
  const browserless = await getBrowserContext(t)
  const url = await runServer(t, ({ req, res }) => {
    if (req.url === '/data.json') {
      return setTimeout(() => {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ loaded: true }))
      }, 300)
    }
    res.setHeader('content-type', 'text/html')
    res.end(`<html><body>
      <div id="result">waiting</div>
      <script>
        fetch('/data.json').then(r => r.json()).then(d => {
          document.getElementById('result').textContent = d.loaded ? 'done' : 'fail'
        })
      </script>
    </body></html>`)
  })

  const getText = browserless.evaluate(async (page, response) =>
    page.evaluate(() => document.getElementById('result').textContent)
  )

  const text = await getText(url, { waitUntil: 'auto' })
  t.is(text, 'done')
})

test('waitUntil auto does not pollute browser history', async t => {
  const browserless = await getBrowserContext(t)
  const url = await runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end('<html><body><h1>ok</h1></body></html>')
  })

  const getHistoryLengths = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, waitUntil: 'load', adblock: false })
    const withoutAuto = await page.evaluate(() => window.history.length)

    await goto(page, { url, waitUntil: 'auto', adblock: false })
    const withAuto = await page.evaluate(() => window.history.length)

    return { withoutAuto, withAuto }
  })

  const { withoutAuto, withAuto } = await getHistoryLengths()
  t.is(withAuto, withoutAuto)
})

test('handle page.goto hanging', async t => {
  const browserless = await getBrowserContext(t)

  const html = await browserless.html('https://test-timeout.vercel.app/', {
    timeout: 5000,
    animations: true
  })

  t.true(html.includes('<body></body>'))
})

test('goto timeout resolves response as undefined (not a settlement object)', async t => {
  const browserless = await getBrowserContext(t)
  const url = await runServer(t, () => {
    // accept the connection but never send headers/body: page.goto gets no
    // navigation response, so stopLoadingOnTimeout wins the race on timeout
    return new Promise(() => {})
  })

  const run = browserless.withPage((page, goto) => async () => {
    const { response } = await goto(page, { url, timeout: 1500, adblock: false })
    return response
  })

  const response = await run()
  // on timeout there is no navigation response: must be falsy, never the
  // `{ isFulfilled, value, ... }` object that `pReflect` would otherwise leak
  t.falsy(response)
})

test('abortTypes keeps behavior with duplicated resource types', async t => {
  const browserless = await getBrowserContext(t)
  const url = await runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end('<html><body><img src="/asset.png"><h1>ok</h1></body></html>')
  })

  const run = browserless.withPage((page, goto) => async () => {
    const outcomes = []

    await goto(page, {
      url,
      abortTypes: ['image', 'image', 'font'],
      onPageRequest: req => {
        const resourceType = req.resourceType()
        if (resourceType !== 'image') return
        outcomes.push(resourceType)
      }
    })

    return outcomes
  })

  const outcomes = await run()
  t.true(outcomes.length >= 1)
})

test('abortTypes is scoped per goto call on the same page', async t => {
  const browserless = await getBrowserContext(t)
  const imageData =
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4AWP8DwQMQMDEAAUAPfgEADYYS7QAAAAASUVORK5CYII='
  let imageRequests = 0

  const url = await runServer(t, ({ req, res }) => {
    if (req.url === '/asset.png') imageRequests += 1

    if (req.url === '/') {
      res.setHeader('content-type', 'text/html')
      return res.end('<html><body><img src="/asset.png"/><h1>ok</h1></body></html>')
    }

    if (req.url === '/asset.png') {
      res.setHeader('content-type', 'image/png')
      return res.end(Buffer.from(imageData, 'base64'))
    }

    res.statusCode = 204
    return res.end()
  })

  const run = browserless.withPage((page, goto) => async () => {
    const listenersBefore = page.listenerCount('request')

    await goto(page, {
      url,
      waitUntil: 'load',
      abortTypes: ['image'],
      adblock: false,
      timeout: 2000
    })

    const listenersAfterFirst = page.listenerCount('request')
    const afterFirst = imageRequests

    await goto(page, { url, waitUntil: 'load', adblock: false, timeout: 2000 })
    const afterSecond = imageRequests

    await goto(page, {
      url,
      waitUntil: 'load',
      abortTypes: ['image'],
      adblock: false,
      timeout: 2000
    })

    const listenersAfterThird = page.listenerCount('request')
    const afterThird = imageRequests

    return {
      listenersBefore,
      listenersAfterFirst,
      listenersAfterThird,
      afterFirst,
      afterSecond,
      afterThird
    }
  })

  const {
    listenersBefore,
    listenersAfterFirst,
    listenersAfterThird,
    afterFirst,
    afterSecond,
    afterThird
  } = await run()

  t.is(afterFirst, 0)
  t.true(afterSecond > afterFirst)
  t.is(afterThird, afterSecond)
  t.is(listenersAfterFirst, listenersBefore)
  t.is(listenersAfterThird, listenersBefore)
})

test('waits interception setup before starting navigation', async t => {
  const browserless = await getBrowserContext(t)
  const imageData =
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4AWP8DwQMQMDEAAUAPfgEADYYS7QAAAAASUVORK5CYII='
  let imageRequests = 0

  const url = await runServer(t, ({ req, res }) => {
    if (req.url === '/asset.png') imageRequests += 1

    if (req.url === '/') {
      res.setHeader('content-type', 'text/html')
      return res.end('<html><body><img src="/asset.png"/><h1>ok</h1></body></html>')
    }

    if (req.url === '/asset.png') {
      res.setHeader('content-type', 'image/png')
      return res.end(Buffer.from(imageData, 'base64'))
    }

    res.statusCode = 204
    return res.end()
  })

  const run = browserless.withPage((page, goto) => async () => {
    const originalSetRequestInterception = page.setRequestInterception.bind(page)

    page.setRequestInterception = (...args) =>
      new Promise(resolve => setTimeout(resolve, 200)).then(() =>
        originalSetRequestInterception(...args)
      )

    await goto(page, {
      url,
      waitUntil: 'load',
      abortTypes: ['image'],
      adblock: false
    })
  })

  await run()
  t.is(imageRequests, 0)
})

test('does not call stopLoading after successful navigation', async t => {
  const browserless = await getBrowserContext(t)
  const url = await runServer(t, ({ res }) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<html><body><h1>ok</h1></body></html>')
  })

  const run = browserless.withPage((page, goto) => async () => {
    const client = page._client()
    const originalSend = client.send.bind(client)
    let stopLoadingCalls = 0

    client.send = (...args) => {
      if (args[0] === 'Page.stopLoading') stopLoadingCalls += 1
      return originalSend(...args)
    }

    await goto(page, { url, waitUntil: 'load', timeout: 900, adblock: false })
    await new Promise(resolve => setTimeout(resolve, 700))

    client.send = originalSend
    return stopLoadingCalls
  })

  t.is(await run(), 0)
})

test('supports waitForSelector and waitForFunction in the same navigation', async t => {
  const browserless = await getBrowserContext(t)
  const url = await runServer(t, ({ res }) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`
      <html>
        <body>
          <script>
            setTimeout(() => {
              const el = document.createElement('div')
              el.id = 'late'
              document.body.appendChild(el)
              window.__ready = true
            }, 60)
          </script>
        </body>
      </html>
    `)
  })

  const run = browserless.withPage(
    (page, goto) => async () =>
      goto(page, {
        url,
        waitUntil: 'load',
        adblock: false,
        waitForSelector: '#late',
        waitForFunction: () => window.__ready === true,
        timeout: 2000
      })
  )

  const { response } = await run()
  t.true(response.ok())
})

const readEmulation = page =>
  page.evaluate(() => ({
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    tabletMediaQuery: window.matchMedia('(max-device-width: 1024px)').matches
  }))

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const readScreen = page =>
  page.evaluate(() => ({
    screen: `${window.screen.width}x${window.screen.height}`,
    fits: window.screen.width >= window.innerWidth && window.screen.height >= window.innerHeight,
    tabletMediaQuery: window.matchMedia('(max-device-width: 1024px)').matches,
    wideMediaQuery: window.matchMedia('(min-device-width: 2560px)').matches,
    ultraWideMediaQuery: window.matchMedia('(min-device-width: 3840px)').matches
  }))

const emulationServer = (t, requests = []) =>
  runServer(t, ({ req, res }) => {
    requests.push(req.headers)
    res.setHeader('content-type', 'text/html')
    res.end('<html><body><h1>ok</h1></body></html>')
  })

test('desktop screen fits the viewport across reloads and navigations', async t => {
  const browserless = await getBrowserContext(t)
  const url = await emulationServer(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, waitUntil: 'load', adblock: false })
    const first = await readEmulation(page)
    await page.reload()
    const afterReload = await readEmulation(page)
    await goto(page, { url, waitUntil: 'load', adblock: false })
    const afterSecondGoto = await readEmulation(page)
    return [first, afterReload, afterSecondGoto]
  })

  for (const state of await run()) {
    t.true(state.screenWidth >= state.innerWidth)
    t.true(state.screenHeight >= state.innerHeight)
    t.false(state.tabletMediaQuery)
  }
})

test('non default desktop viewport renders inside a screen that fits it', async t => {
  const browserless = await getBrowserContext(t)
  const url = await emulationServer(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, {
      url,
      viewport: { width: 1920, height: 1080 },
      waitUntil: 'load',
      adblock: false
    })
    return readEmulation(page)
  })

  const state = await run()
  t.is(state.innerWidth, 1920)
  t.true(state.screenWidth >= state.innerWidth)
  t.true(state.screenHeight >= state.innerHeight)
})

test('screen stays fitted after puppeteer re-applies the same viewport', async t => {
  const browserless = await getBrowserContext(t)
  const url = await emulationServer(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, waitUntil: 'load', adblock: false })
    await page.setViewport(page.viewport())
    await goto(page, { url, waitUntil: 'load', adblock: false })
    const afterSetViewport = await readEmulation(page)
    await page.screenshot({ fullPage: true, captureBeyondViewport: false })
    await goto(page, { url, waitUntil: 'load', adblock: false })
    const afterScreenshot = await readEmulation(page)
    return [afterSetViewport, afterScreenshot]
  })

  for (const state of await run()) {
    t.true(state.screenWidth >= state.innerWidth)
    t.false(state.tabletMediaQuery)
  }
})

test('screen is re-applied as soon as puppeteer re-applies the viewport', async t => {
  const browserless = await getBrowserContext(t)
  const url = await emulationServer(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, {
      url,
      viewport: { width: 1920, height: 1200 },
      waitUntil: 'load',
      adblock: false
    })
    await page.setViewport(page.viewport())
    const afterSetViewport = await readScreen(page)
    await page.screenshot({ fullPage: true, captureBeyondViewport: false })
    const afterScreenshot = await readScreen(page)
    return [afterSetViewport, afterScreenshot]
  })

  for (const state of await run()) {
    t.true(state.fits, JSON.stringify(state))
    t.false(state.tabletMediaQuery)
  }
})

test('changing the viewport right before closing the page leaves no unhandled rejection', async t => {
  const browserless = await getBrowserContext(t)
  const url = await emulationServer(t)
  const unhandled = []
  const onUnhandledRejection = error => unhandled.push(error.message)
  process.on('unhandledRejection', onUnhandledRejection)
  t.teardown(() => process.off('unhandledRejection', onUnhandledRejection))

  const settled = []
  for (let round = 0; round < 5; round++) {
    const page = await browserless.page()
    await browserless.goto(page, { url, waitUntil: 'load', adblock: false })
    const pending = page.setViewport({ width: 1400, height: 900 }).then(
      () => 'resolved',
      error => error.message
    )
    await page.close()
    settled.push(await pending)
  }
  await sleep(500)

  t.deepEqual(unhandled, [])
  t.deepEqual(settled, Array(5).fill('resolved'))
})

test('a metrics override that bypasses page.setViewport still carries the screen', async t => {
  const browserless = await getBrowserContext(t)
  const url = await emulationServer(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, waitUntil: 'load', adblock: false })
    await Object.getPrototypeOf(page).setViewport.call(page, page.viewport())
    const afterBypass = await readScreen(page)
    await goto(page, { url, waitUntil: 'load', adblock: false })
    const afterGoto = await readScreen(page)
    return [afterBypass, afterGoto]
  })

  for (const state of await run()) {
    t.true(state.fits, JSON.stringify(state))
    t.false(state.tabletMediaQuery)
  }
})

test('full page screenshots never change the screen or device width media queries', async t => {
  const browserless = await getBrowserContext(t)
  const queries = [
    '(max-device-width: 1024px)',
    '(min-device-width: 1366px)',
    '(min-device-width: 1440px)',
    '(min-device-width: 1920px)'
  ]
  const url = await runServer(t, ({ req, res }) => {
    res.setHeader('content-type', 'text/html')
    const body =
      req.url === '/short'
        ? '<div style="height:1000px">short</div>'
        : `<p>${'lorem ipsum '.repeat(2500)}</p>`
    res.end(`<html><head><script>
      window.__changes = []
      window.__screens = [screen.width + 'x' + screen.height]
      for (const query of ${JSON.stringify(queries)}) {
        matchMedia(query).addEventListener('change', () => window.__changes.push(query))
      }
      addEventListener('resize', () => window.__screens.push(screen.width + 'x' + screen.height))
    </script></head><body style="margin:0">${body}</body></html>`)
  })

  const run = browserless.withPage((page, goto) => async () => {
    const results = []
    for (const path of ['short', 'tall']) {
      for (const captureBeyondViewport of [false, true]) {
        await goto(page, { url: `${url}${path}`, waitUntil: 'load', adblock: false })
        await page.screenshot({ fullPage: true, captureBeyondViewport })
        await page.evaluate(
          () =>
            new Promise(resolve =>
              window.requestAnimationFrame(() =>
                window.requestAnimationFrame(() => setTimeout(resolve, 250))
              )
            )
        )
        results.push({
          path,
          captureBeyondViewport,
          ...(await page.evaluate(() => ({
            changes: window.__changes,
            screens: [...new Set(window.__screens)]
          })))
        })
      }
    }
    return results
  })

  for (const result of await run()) {
    t.deepEqual(result.changes, [], JSON.stringify(result))
    t.deepEqual(result.screens, ['1440x900'], JSON.stringify(result))
  }
})

test('popups opened by a navigated page keep the screen of untouched pages', async t => {
  const browserless = await getBrowserContext(t)
  const url = await runServer(t, ({ req, res }) => {
    res.setHeader('content-type', 'text/html')
    if (req.url === '/popup') return res.end('<html><body>popup</body></html>')
    res.end(
      '<html><body><a id="blank" href="/popup" target="_blank" rel="opener">blank</a></body></html>'
    )
  })
  const context = await browserless.context()
  const untouched = await context.newPage()
  t.teardown(() => untouched.close())
  await untouched.goto(`${url}popup`)
  const expected = await readScreen(untouched)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, waitUntil: 'load', adblock: false })
    const waitForPopup = () => new Promise(resolve => page.once('popup', resolve))
    const [opened] = await Promise.all([
      waitForPopup(),
      page.evaluate(() => {
        window.open('/popup')
      })
    ])
    await page.bringToFront()
    const [blank] = await Promise.all([waitForPopup(), page.click('#blank')])
    const popups = [opened, blank]
    await Promise.all(
      popups.map(popup => popup.waitForFunction(() => document.readyState === 'complete'))
    )
    const screens = await Promise.all(popups.map(readScreen))
    await Promise.all(popups.map(popup => popup.close()))
    return screens
  })

  for (const state of await run()) t.is(state.screen, expected.screen)
})

test('a connection that cannot be intercepted still applies the viewport', async t => {
  const browserless = await getBrowserContext(t)
  const url = await emulationServer(t)
  const browser = await puppeteer.connect({
    browserWSEndpoint: await getBrowserWSEndpoint(),
    defaultViewport: browserless.goto.defaultViewport
  })
  t.teardown(() => browser.disconnect())
  const context = await browser.createBrowserContext()
  t.teardown(() => context.close())
  const page = await context.newPage()
  const connection = page._client().connection()
  Object.defineProperty(connection, '_rawSend', { value: connection._rawSend, writable: false })

  const { error } = await browserless.goto(page, {
    url,
    viewport: { width: 1920, height: 1080 },
    waitUntil: 'load',
    adblock: false
  })
  const state = await readEmulation(page)

  t.falsy(error)
  t.is(state.innerWidth, 1920)
  t.is(state.innerHeight, 1080)
})

test('a prerendered page activated by a click keeps a fitting screen', async t => {
  const browserless = await getBrowserContext(t)
  const prerendered = []
  const url = await runServer(t, ({ req, res }) => {
    res.setHeader('content-type', 'text/html')
    res.setHeader('cache-control', 'no-store')
    if (req.url === '/next') {
      if (/prerender/.test(req.headers['sec-purpose'] || '')) prerendered.push(req.url)
      return res.end('<html><body><h1>next</h1></body></html>')
    }
    res.end(
      '<html><head><script type="speculationrules">{"prerender":[{"source":"list","urls":["/next"],"eagerness":"immediate"}]}</script></head><body><a id="next" href="/next">next</a></body></html>'
    )
  })

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, waitUntil: 'load', adblock: false })
    const initialSession = page._client()
    for (let attempt = 0; attempt < 50 && prerendered.length === 0; attempt++) await sleep(100)
    await sleep(1000)
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#next')])
    return { swapped: page._client() !== initialSession, state: await readScreen(page) }
  })

  const { swapped, state } = await run()
  t.true(prerendered.length > 0)
  t.true(swapped)
  t.true(state.fits, JSON.stringify(state))
  t.false(state.tabletMediaQuery)
})

test('a default navigation keeps a desktop viewport set by the user', async t => {
  const browserless = await getBrowserContext(t)
  const url = await emulationServer(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, waitUntil: 'load', adblock: false })
    await page.setViewport({ width: 1024, height: 700 })
    await goto(page, { url, waitUntil: 'load', adblock: false })
    return readEmulation(page)
  })

  const state = await run()
  t.is(state.innerWidth, 1024)
  t.true(state.screenWidth >= state.innerWidth)
  t.false(state.tabletMediaQuery)
})

test('a page viewport never changes the screen of other pages', async t => {
  const browserless = await getBrowserContext(t)
  const other = await getBrowserContext(t)
  const url = await emulationServer(t)
  const watcher = await browserless.page()
  t.teardown(() => watcher.close())

  await browserless.goto(watcher, { url, waitUntil: 'load', adblock: false })
  const before = await readScreen(watcher)

  const run = other.withPage((page, goto) => async () => {
    await goto(page, {
      url,
      viewport: { width: 1920, height: 1200 },
      waitUntil: 'load',
      adblock: false
    })
    await goto(page, {
      url,
      viewport: { width: 5000, height: 3000, deviceScaleFactor: 1 },
      waitUntil: 'load',
      adblock: false
    })
  })
  await run()

  t.deepEqual(await readScreen(watcher), before)
  t.false(before.wideMediaQuery)
})

test('a large viewport elsewhere does not make later default pages report a huge screen', async t => {
  const browserless = await getBrowserContext(t)
  const url = await emulationServer(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, {
      url,
      viewport: { width: 5000, height: 3000, deviceScaleFactor: 1 },
      waitUntil: 'load',
      adblock: false
    })
  })
  await run()

  const readDefault = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, waitUntil: 'load', adblock: false })
    return readScreen(page)
  })
  const state = await readDefault()

  t.is(state.screen, '1440x900')
  t.false(state.ultraWideMediaQuery)
})

test('connect mode clients sharing one browser keep their own screens', async t => {
  const browserless = await getBrowserContext(t)
  const url = await emulationServer(t)
  const browserWSEndpoint = await getBrowserWSEndpoint()
  const connect = async () => {
    const browser = await puppeteer.connect({
      browserWSEndpoint,
      defaultViewport: browserless.goto.defaultViewport
    })
    t.teardown(() => browser.disconnect())
    const context = await browser.createBrowserContext()
    t.teardown(() => context.close())
    return context
  }
  const opts = { url, waitUntil: 'load', adblock: false }

  const owner = await puppeteer.connect({ browserWSEndpoint })
  t.teardown(() => owner.disconnect())
  const session = await owner.target().createCDPSession()
  const { screenInfos } = await session.send('Emulation.getScreenInfos')
  const primary = screenInfos.find(({ isPrimary }) => isPrimary)
  t.teardown(() =>
    session.send('Emulation.updateScreen', {
      screenId: primary.id,
      width: primary.width,
      height: primary.height
    })
  )
  await session.send('Emulation.updateScreen', { screenId: primary.id, width: 800, height: 600 })

  const [clientA, clientB] = await Promise.all([connect(), connect()])
  const pageA = await clientA.newPage()
  await browserless.goto(pageA, opts)
  const pageB = await clientB.newPage()
  await browserless.goto(pageB, { ...opts, viewport: { width: 1920, height: 1200 } })
  const pageA2 = await clientA.newPage()
  await browserless.goto(pageA2, { ...opts, viewport: { width: 1920, height: 1080 } })

  await pageB.reload()
  const afterOtherClient = await readScreen(pageB)
  await browserless.goto(pageB, { ...opts, viewport: { width: 1920, height: 1200 } })
  const afterRepeatGoto = await readScreen(pageB)

  t.true(afterOtherClient.fits, JSON.stringify(afterOtherClient))
  t.true(afterRepeatGoto.fits, JSON.stringify(afterRepeatGoto))
})

test('switching from a mobile device back to the default device restores desktop metrics', async t => {
  const browserless = await getBrowserContext(t)
  const url = await emulationServer(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, device: 'iPhone 15', waitUntil: 'load', adblock: false })
    const { device } = await goto(page, { url, waitUntil: 'load', adblock: false })
    return { device, state: await readEmulation(page) }
  })

  const { device, state } = await run()
  t.is(state.innerWidth, device.viewport.width)
  t.true(state.screenWidth >= state.innerWidth)
  t.false(state.tabletMediaQuery)
})

test('repeat navigations do not add emulation round trips', async t => {
  const browserless = await getBrowserContext(t)
  const url = await emulationServer(t)

  const run = browserless.withPage((page, goto) => async () => {
    const client = page._client()
    const originalSend = client.send.bind(client)
    const calls = []
    client.send = (method, ...args) => {
      calls.push(method)
      return originalSend(method, ...args)
    }

    const countRepeatGoto = async opts => {
      await goto(page, { url, waitUntil: 'load', adblock: false, ...opts })
      calls.length = 0
      await goto(page, { url, waitUntil: 'load', adblock: false, ...opts })
      return calls.filter(method => method.startsWith('Emulation.'))
    }

    const counts = {
      defaultDevice: await countRepeatGoto({}),
      desktopViewport: await countRepeatGoto({ viewport: { width: 1920, height: 1080 } }),
      mobileDevice: await countRepeatGoto({ device: 'iPhone 15' })
    }

    client.send = originalSend
    return counts
  })

  const counts = await run()
  const emulationCalls = ['defaultDevice', 'desktopViewport', 'mobileDevice'].map(name =>
    counts[name].filter(method => method !== 'Emulation.setEmulatedMedia')
  )
  t.deepEqual(emulationCalls, [[], [], []], JSON.stringify(counts))
})

test('mobile screen matches the device viewport', async t => {
  const browserless = await getBrowserContext(t)
  const url = await emulationServer(t)

  const run = browserless.withPage((page, goto) => async () => {
    const { device } = await goto(page, {
      url,
      device: 'Galaxy S8',
      waitUntil: 'load',
      adblock: false
    })
    return { device, state: await readEmulation(page) }
  })

  const { device, state } = await run()
  t.is(state.screenWidth, device.viewport.width)
  t.is(state.screenHeight, device.viewport.height)
})
