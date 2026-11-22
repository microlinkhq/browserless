'use strict'

const { runServer, getBrowserContext } = require('@browserless/test')
const { default: test } = require('ava')

const IMPORT_DELAY_MS = 500

const html = `<!doctype html>
<html>
  <body>
    <div id="box" style="transition: opacity 2s 1s; animation: spin 3s 1s infinite">box</div>
  </body>
</html>`

const wrapsCreateElement = html.replace(
  '<body>',
  `<body>
    <script>
      document.createElement = new Proxy(document.createElement, {
        apply: (create, self, [tag, ...rest]) => {
          if (String(tag).toLowerCase() === 'style') throw new Error('blocked')
          return Reflect.apply(create, self, [tag, ...rest])
        }
      })
    </script>`
)

const serve = (t, page = html) =>
  runServer(t, ({ req, res }) => {
    if (req.url === '/slow.css') {
      setTimeout(() => {
        res.setHeader('content-type', 'text/css')
        res.end('#box { color: rgb(1, 2, 3) }')
      }, IMPORT_DELAY_MS)
      return
    }
    res.setHeader('content-type', 'text/html')
    res.end(page)
  })

const gotoAndRead = async (t, opts, page) => {
  const url = await serve(t, page)
  const browserless = await getBrowserContext(t)
  return browserless.withPage((page, goto) => async () => {
    await goto(page, { url, adblock: false, waitUntil: 'load', ...opts })
    return page.$eval('#box', el => {
      const style = window.getComputedStyle(el)
      return {
        transitionDuration: style.transitionDuration,
        transitionDelay: style.transitionDelay,
        animationDuration: style.animationDuration,
        color: style.color
      }
    })
  })()
}

test('animations are disabled by the time goto returns', async t => {
  const style = await gotoAndRead(t, { animations: false })
  t.is(style.transitionDuration, '0s')
  t.is(style.transitionDelay, '0s')
  t.is(style.animationDuration, '0s')
})

test('animations are disabled even when the page wraps createElement', async t => {
  const style = await gotoAndRead(t, { animations: false }, wrapsCreateElement)
  t.is(style.transitionDuration, '0s')
})

test('an inline style that imports a slow sheet is applied by the time goto returns', async t => {
  const url = await serve(t)
  const style = await gotoAndRead(t, { styles: [`@import url("${url}slow.css");`] })
  t.is(style.color, 'rgb(1, 2, 3)')
})
