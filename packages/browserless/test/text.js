'use strict'

const test = require('ava')

const { runServer, getBrowserContext } = require('@browserless/test')

const getInnerTextSpyUrl = async t => {
  const foreignReads = []

  const url = await runServer(t, ({ req, res }) => {
    if (req.method === 'POST') {
      let body = ''
      req.on('data', chunk => {
        body += chunk
      })
      req.on('end', () => {
        foreignReads.push(body)
        res.end()
      })
      return
    }

    res.setHeader('content-type', 'text/html')
    res.end(`<!DOCTYPE html>
<html>
<head>
  <script>
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText')
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      ...descriptor,
      get () {
        const callers = new Error().stack.split('\\n').slice(2)
        if (!callers.some(line => line.includes(location.origin))) {
          const request = new XMLHttpRequest()
          request.open('POST', '/foreign-read', false)
          request.send(callers.join('\\n'))
        }
        return descriptor.get.call(this)
      }
    })
  </script>
</head>
<body>
  <p>hello world</p>
</body>
</html>`)
  })

  return { url, foreignReads }
}

test('page hook detects innerText reads from the main world', async t => {
  const browserless = await getBrowserContext(t)
  const { url, foreignReads } = await getInnerTextSpyUrl(t)

  const text = await browserless.evaluate(page => page.evaluate(() => document.body.innerText))(
    url,
    { adblock: false }
  )

  t.is(text, 'hello world')
  t.true(foreignReads.length > 0)
})

test('text() is invisible to main world innerText hooks', async t => {
  const browserless = await getBrowserContext(t)
  const { url, foreignReads } = await getInnerTextSpyUrl(t)

  const text = await browserless.text(url, { adblock: false })

  t.is(text, 'hello world')
  t.deepEqual(foreignReads, [])
})
