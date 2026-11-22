'use strict'

const { runServer, getBrowserContext } = require('@browserless/test')
const { default: test } = require('ava')

const IMPORT_DELAY_MS = 500

const box =
  '<div id="box" style="transition: opacity 2s 1s; animation: spin 3s 1s infinite">box</div>'

const html = (head = '') => `<!doctype html>
<html>
  <head>${head}</head>
  <body>
    ${box}
  </body>
</html>`

const mainWorldStyleHook = `<script>
  const createElement = document.createElement.bind(document)
  const createElementNS = document.createElementNS.bind(document)
  const blockStyle = element => {
    element.disabled = true
    return element
  }
  document.createElement = function (tag) {
    const element = createElement(tag)
    return String(tag).toLowerCase() === 'style' ? blockStyle(element) : element
  }
  document.createElementNS = function (namespace, tag) {
    const element = createElementNS(namespace, tag)
    return String(tag).toLowerCase() === 'style' ? blockStyle(element) : element
  }
</script>`

const wrapsCreateElement = html().replace(
  '<body>',
  `<body>
    <script>
      const block = (create, self, args, tag) => {
        if (String(tag).toLowerCase() === 'style') throw new Error('blocked')
        return Reflect.apply(create, self, args)
      }
      document.createElement = new Proxy(document.createElement, {
        apply: (create, self, args) => block(create, self, args, args[0])
      })
      document.createElementNS = new Proxy(document.createElementNS, {
        apply: (create, self, args) => block(create, self, args, args[1])
      })
    </script>`
)

const serve = (t, body = html()) =>
  runServer(t, ({ req, res }) => {
    if (req.url === '/slow.css') {
      setTimeout(() => {
        res.setHeader('content-type', 'text/css')
        res.end('#box { color: rgb(1, 2, 3) }')
      }, IMPORT_DELAY_MS)
      return
    }
    res.setHeader('content-type', 'text/html')
    res.end(body)
  })

const gotoAndRead = async (t, buildOpts, body) => {
  const url = await serve(t, body)
  const opts = typeof buildOpts === 'function' ? buildOpts(url) : buildOpts
  const browserless = await getBrowserContext(t)
  return browserless.withPage((page, goto) => async () => {
    await goto(page, { url, adblock: false, waitUntil: 'load', ...opts })
    return page.evaluate(() => {
      const el = document.getElementById('box')
      const style = window.getComputedStyle(el)
      const inHead = [...(document.head ? document.head.children : [])].some(
        node => node.tagName === 'STYLE' && node.textContent.includes('animation-duration')
      )
      return {
        transitionDuration: style.transitionDuration,
        transitionDelay: style.transitionDelay,
        animationDuration: style.animationDuration,
        color: style.color,
        inHead
      }
    })
  })()
}

test('animations are disabled by the time goto returns', async t => {
  const style = await gotoAndRead(t, { animations: false })
  t.is(style.transitionDuration, '0s')
  t.is(style.transitionDelay, '0s')
  t.is(style.animationDuration, '0s')
  t.true(style.inHead)
})

test('animations are disabled on a document that has no head', async t => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" id="box" style="transition: opacity 2s 1s; animation: spin 3s 1s infinite">
    <script><![CDATA[
      const createElementNS = document.createElementNS.bind(document)
      document.createElementNS = function (namespace, tag) {
        const element = createElementNS(namespace, tag)
        if (String(tag).toLowerCase() === 'style') element.disabled = true
        return element
      }
    ]]></script>
  </svg>`
  const url = await runServer(t, ({ res }) => {
    res.setHeader('content-type', 'image/svg+xml')
    res.end(svg)
  })
  const browserless = await getBrowserContext(t)
  const style = await browserless.withPage((page, goto) => async () => {
    await goto(page, { url, adblock: false, waitUntil: 'load', animations: false })
    return page.evaluate(() => {
      const computed = window.getComputedStyle(document.getElementById('box'))
      return {
        transitionDuration: computed.transitionDuration,
        transitionDelay: computed.transitionDelay,
        animationDuration: computed.animationDuration,
        hasHead: document.head !== null
      }
    })
  })()
  t.false(style.hasHead)
  t.is(style.transitionDuration, '0s')
  t.is(style.transitionDelay, '0s')
  t.is(style.animationDuration, '0s')
})

test('a page that hooks createElement still gets animations disabled', async t => {
  const style = await gotoAndRead(t, { animations: false }, html(mainWorldStyleHook))
  t.is(style.transitionDuration, '0s')
  t.is(style.transitionDelay, '0s')
  t.is(style.animationDuration, '0s')
})

test('animations stay when they are left on', async t => {
  const style = await gotoAndRead(t, { animations: true })
  t.is(style.transitionDuration, '2s')
  t.is(style.transitionDelay, '1s')
  t.is(style.animationDuration, '3s')
})

test('animations are disabled even when the page wraps createElement', async t => {
  const style = await gotoAndRead(t, { animations: false }, wrapsCreateElement)
  t.is(style.transitionDuration, '0s')
})

test('an inline style that imports a slow sheet is applied by the time goto returns', async t => {
  const style = await gotoAndRead(t, url => ({ styles: [`@import url("${url}slow.css");`] }))
  t.is(style.color, 'rgb(1, 2, 3)')
})
