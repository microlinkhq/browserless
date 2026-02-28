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

test('handle page.goto hanging', async t => {
  const browserless = await getBrowserContext(t)

  const html = await browserless.html('https://test-timeout.vercel.app/', {
    timeout: 5000,
    animations: true
  })

  t.true(html.includes('<body></body>'))
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
