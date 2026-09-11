'use strict'

const { runServer, getBrowserContext } = require('@browserless/test')
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

const readHints = page =>
  page.evaluate(async () => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    brands: navigator.userAgentData.brands,
    hints: await navigator.userAgentData.getHighEntropyValues([
      'platform',
      'platformVersion',
      'fullVersionList'
    ])
  }))

const hintsServer = (t, requests = []) =>
  runServer(t, ({ req, res }) => {
    requests.push(req.headers)
    res.setHeader('content-type', 'text/html')
    res.end('<html><body><h1>ok</h1></body></html>')
  })

test('Chrome user agent sends matching client hints', async t => {
  const browserless = await getBrowserContext(t)
  const requests = []
  const url = await hintsServer(t, requests)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, waitUntil: 'load', adblock: false })
    return readHints(page)
  })

  const state = await run()
  const major = state.userAgent.match(/Chrome\/(\d+)/)[1]

  t.true(requests[0]['sec-ch-ua'].includes(`"Google Chrome";v="${major}"`))
  t.true(state.brands.some(({ brand, version }) => brand === 'Google Chrome' && version === major))
  t.is(state.hints.platform, 'macOS')
  t.is(state.platform, 'MacIntel')
})

test('Windows and Linux user agents send matching client hints', async t => {
  const browserless = await getBrowserContext(t)
  const requests = []
  const url = await hintsServer(t, requests)
  const userAgents = {
    Windows:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    Linux:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
  }

  const run = browserless.withPage((page, goto) => async () => {
    const states = {}
    for (const [name, userAgent] of Object.entries(userAgents)) {
      requests.length = 0
      await goto(page, {
        url,
        headers: { 'user-agent': userAgent },
        waitUntil: 'load',
        adblock: false
      })
      states[name] = { headers: requests[0], ...(await readHints(page)) }
    }
    return states
  })

  const { Windows, Linux } = await run()
  t.is(Windows.headers['sec-ch-ua-platform'], '"Windows"')
  t.is(Windows.platform, 'Win32')
  t.is(Windows.hints.platform, 'Windows')
  t.is(Linux.headers['sec-ch-ua-platform'], '"Linux"')
  t.is(Linux.platform, 'Linux x86_64')
  t.is(Linux.hints.platform, 'Linux')
  t.is(Linux.hints.platformVersion, '')
})

test('Android Chrome device reports mobile client hints', async t => {
  const browserless = await getBrowserContext(t)
  const url = await hintsServer(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, device: 'Galaxy S8', waitUntil: 'load', adblock: false })
    return readHints(page)
  })

  const state = await run()
  t.true(state.brands.some(({ brand }) => brand === 'Google Chrome'))
  t.is(state.hints.platform, 'Android')
  t.is(state.platform, 'Linux armv8l')
})

test('non Chrome user agents get no fabricated client hints', async t => {
  const browserless = await getBrowserContext(t)
  const requests = []
  const url = await hintsServer(t, requests)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, device: 'iPhone 15', waitUntil: 'load', adblock: false })
    const iphone = await readHints(page)
    await goto(page, {
      url,
      headers: { 'user-agent': 'googlebot' },
      waitUntil: 'load',
      adblock: false
    })
    const googlebot = await readHints(page)
    return [iphone, googlebot]
  })

  for (const state of await run()) t.deepEqual(state.brands, [])
  t.false(requests.some(headers => (headers['sec-ch-ua'] || '').includes('Google Chrome')))
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
