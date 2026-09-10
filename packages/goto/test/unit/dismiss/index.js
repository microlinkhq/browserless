'use strict'

const test = require('ava')

const { runServer, getBrowserContext } = require('@browserless/test')

const dismiss = require('../../../src/dismiss')

const page = body => `<html><body><h1>hello</h1>${body}</body></html>`

const serve = (t, body) =>
  runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(page(body))
  })

/* poll from Node: in-page timers/rAF can be throttled for background pages */
const waitFor = async (page, fn, attempts = 100) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await page.evaluate(fn).catch(() => false)
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return false
}

const evaluateInDismissWorld = async (page, expression) => {
  const client = page._client()
  const { executionContextId } = await client.send('Page.createIsolatedWorld', {
    frameId: page.mainFrame()._id,
    worldName: dismiss.WORLD_NAME
  })
  const { result } = await client.send('Runtime.evaluate', {
    expression,
    contextId: executionContextId,
    returnByValue: true
  })
  return result.value
}

const DIALOG = `
  <div id="notice" role="alertdialog" style="position:fixed;top:20%;left:20%;background:#fff;padding:16px;z-index:9999">
    <h2>Important Notice</h2>
    <p>We will be removing the following works from our website.</p>
    <button onclick="window.__clicked='ack';document.getElementById('notice').remove()">I understand</button>
  </div>`

const STICKY = `
  <div id="sticky" role="alertdialog" style="position:fixed;top:20%;left:20%;background:#fff;padding:16px">
    <p>Scheduled maintenance this weekend.</p>
    <button type="button" onclick="window.__clicks=(window.__clicks||0)+1">OK</button>
  </div>`

/* records every selector the page's main world is asked to query */
const QUERY_RECORDER = `<script>
  window.__queries = []
  for (const proto of [Document.prototype, Element.prototype]) {
    for (const name of ['querySelector', 'querySelectorAll']) {
      const original = proto[name]
      proto[name] = function (...args) {
        window.__queries.push(args[0])
        return original.apply(this, args)
      }
    }
  }
</script>`

test('dismisses an announcement dialog with an acknowledge button', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, DIALOG)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    return waitFor(page, () => window.__clicked)
  })

  t.is(await run(), 'ack')
})

test('dismisses a dialog mounted after load', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(
    t,
    `<script>setTimeout(() => { document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(
      DIALOG
    )}) }, 500)</script>`
  )

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    return waitFor(page, () => window.__clicked)
  })

  t.is(await run(), 'ack')
})

test('dismisses a native <dialog> element', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(
    t,
    `<dialog open id="notice">
       <p>Scheduled maintenance this weekend.</p>
       <button onclick="window.__clicked='ok';document.getElementById('notice').remove()">OK</button>
     </dialog>`
  )

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    return waitFor(page, () => window.__clicked)
  })

  t.is(await run(), 'ok')
})

test('dismisses via aria-label close button when the dialog has form fields', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(
    t,
    `<div id="notice" role="dialog" style="position:fixed;top:20%;left:20%;background:#fff;padding:16px">
       <p>Subscribe to our newsletter</p>
       <input type="email" placeholder="email">
       <button onclick="window.__clicked='subscribe'">Subscribe</button>
       <button aria-label="Close" onclick="window.__clicked='close';document.getElementById('notice').remove()">×</button>
     </div>`
  )

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    return waitFor(page, () => window.__clicked)
  })

  t.is(await run(), 'close')
})

/* the dialog must survive: a `type="button"` keeps the click from
   navigating, so a wrong dismissal removes the node and fails the test */
const stillPresent = (page, selector) =>
  page.evaluate(sel => !!document.querySelector(sel), selector)

test('does not touch a dialog without acknowledge buttons', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(
    t,
    `<div id="notice" role="dialog" style="position:fixed;top:20%;left:20%;background:#fff;padding:16px">
       <p>Choose your plan</p>
       <button type="button" onclick="window.__clicked='buy';this.closest('#notice').remove()">Buy now</button>
       <button type="button" onclick="window.__clicked='trial';this.closest('#notice').remove()">Start trial</button>
     </div>`
  )

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    await new Promise(resolve => setTimeout(resolve, 2000))
    return {
      clicked: await page.evaluate(() => window.__clicked || false),
      present: await stillPresent(page, '#notice')
    }
  })

  const { clicked, present } = await run()
  t.is(clicked, false, 'no button must be clicked')
  t.is(present, true, 'dialog must remain in the DOM')
})

test('does not click acknowledge-text buttons inside a dialog with form fields', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(
    t,
    `<div id="notice" role="dialog" style="position:fixed;top:20%;left:20%;background:#fff;padding:16px">
       <form onsubmit="return false">
         <p>Log in to continue</p>
         <input type="password" placeholder="password">
         <button type="button" onclick="window.__clicked='submit';this.closest('#notice').remove()">Continue</button>
       </form>
     </div>`
  )

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    await new Promise(resolve => setTimeout(resolve, 2000))
    return {
      clicked: await page.evaluate(() => window.__clicked || false),
      present: await stillPresent(page, '#notice')
    }
  })

  const { clicked, present } = await run()
  t.is(clicked, false, 'form-field dialog must not be auto-dismissed')
  t.is(present, true, 'dialog must remain in the DOM')
})

test('does nothing when `adblock` is false', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, DIALOG)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, adblock: false })
    await new Promise(resolve => setTimeout(resolve, 2000))
    return {
      clicked: await page.evaluate(() => window.__clicked || false),
      injected: await evaluateInDismissWorld(page, 'window.__browserlessDismiss !== undefined')
    }
  })

  const { clicked, injected } = await run()
  t.is(clicked, false, 'no button must be clicked')
  t.is(injected, false, 'dismiss script must not be injected')
})

test('dismiss.run fallback works when injection did not run', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, DIALOG)

  const run = browserless.withPage((page, goto) => async () => {
    /* simulate a document where the new-document injection never ran */
    const client = page._client()
    const send = client.send.bind(client)
    client.send = (method, params, ...rest) =>
      method === 'Page.addScriptToEvaluateOnNewDocument' && params?.worldName === dismiss.WORLD_NAME
        ? Promise.resolve({ identifier: '' })
        : send(method, params, ...rest)
    await goto(page, { url })
    return waitFor(page, () => window.__clicked)
  })

  t.is(await run(), 'ack')
})

test('keeps dismiss state out of the page main world', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, DIALOG)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    return {
      clicked: await waitFor(page, () => window.__clicked),
      visibleToPage: await page.evaluate(() => '__browserlessDismiss' in window),
      worldClicks: await evaluateInDismissWorld(page, 'window.__browserlessDismiss.clicked')
    }
  })

  const { clicked, visibleToPage, worldClicks } = await run()
  t.is(clicked, 'ack')
  t.is(visibleToPage, false, 'the page must not see dismiss state')
  t.is(worldClicks, 1, 'dismiss state must live in its isolated world')
})

test('does not query the DOM from the page main world', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, QUERY_RECORDER + DIALOG)

  const run = browserless.withPage(page => async () => {
    await dismiss.setup(page)
    await page.goto(url)
    const clicked = await waitFor(page, () => window.__clicked)
    await dismiss.run(page)
    return { clicked, queries: await page.evaluate(() => window.__queries) }
  })

  const { clicked, queries } = await run()
  t.is(clicked, 'ack')
  t.deepEqual(queries, [], 'page hooks must not observe dismiss queries')
})

test('run after setup reuses the injected instance instead of clicking twice', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, STICKY)

  const run = browserless.withPage(page => async () => {
    await dismiss.setup(page)
    await page.goto(url)
    await waitFor(page, () => window.__clicks)
    const clicked = await dismiss.run(page)
    await new Promise(resolve => setTimeout(resolve, 500))
    return { clicked, clicks: await page.evaluate(() => window.__clicks) }
  })

  const { clicked, clicks } = await run()
  t.is(clicked, 1, 'run must report the clicks of the injected instance')
  t.is(clicks, 1, 'the dialog must be clicked exactly once')
})

/* navigate without goto and inject after load so only dismiss's re-scan runs
   on it, isolating the consent guard from autoconsent (which legitimately
   handles such dialogs) */
test('dismiss leaves cookie-consent dialogs to autoconsent', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, '<p>no dialog yet</p>')

  const run = browserless.withPage(page => async () => {
    await dismiss.setup(page)
    await page.goto(url)
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div id="consent" role="dialog" style="position:fixed;bottom:0;left:0;right:0;background:#fff;padding:16px">
           <p>We use cookies to improve your experience on this website.</p>
           <button type="button" onclick="window.__clicked='ok';document.getElementById('consent').remove()">OK</button>
         </div>`
      )
    })
    await dismiss.run(page)
    return page.evaluate(() => ({
      clicked: window.__clicked || false,
      present: !!document.querySelector('#consent')
    }))
  })

  const { clicked, present } = await run()
  t.is(clicked, false, 'dismiss must not click a consent dialog')
  t.is(present, true, 'consent dialog must remain for autoconsent')
})

/* A CMP that exposes a reject button must be left to autoconsent's opt-out,
   never acknowledged via its "OK". Each case varies only the consent copy and
   the reject button's label (the reject vocabulary under test). */
const REJECT_CASES = [
  {
    name: 'a reject button',
    copy: '<p>We need your permission to track you across the web.</p>',
    reject: 'Reject all'
  },
  {
    name: 'a reject button before consent copy loads',
    copy: '',
    reject: 'Reject all'
  },
  {
    name: 'a reject button with the "cookies" suffix',
    copy: '<p>We need your permission to track you across the web.</p>',
    reject: 'Reject all cookies'
  },
  {
    name: 'a German "Ablehnen" button',
    copy: '<p>Wir und unsere Partner verarbeiten Daten fuer Werbung.</p>',
    reject: 'Ablehnen'
  },
  {
    name: 'a French "Continuer sans accepter" button',
    copy: '<p>Nous et nos partenaires suivons votre navigation.</p>',
    reject: 'Continuer sans accepter'
  }
]

for (const { name, copy, reject } of REJECT_CASES) {
  test(`dismiss leaves a CMP with ${name} to autoconsent`, async t => {
    const browserless = await getBrowserContext(t)
    const url = await serve(t, '<p>no dialog yet</p>')

    const run = browserless.withPage(page => async () => {
      await dismiss.setup(page)
      await page.goto(url)
      await page.evaluate(
        ({ copy, reject }) => {
          document.body.insertAdjacentHTML(
            'beforeend',
            `<div id="cmp" role="dialog" style="position:fixed;bottom:0;left:0;right:0;background:#fff;padding:16px">
               ${copy}
               <button type="button" onclick="window.__clicked='reject';document.getElementById('cmp').remove()">${reject}</button>
               <button type="button" onclick="window.__clicked='ok';document.getElementById('cmp').remove()">OK</button>
             </div>`
          )
        },
        { copy, reject }
      )
      const dismissClicks = await dismiss.run(page)
      return {
        dismissClicks,
        ...(await page.evaluate(() => ({
          clicked: window.__clicked || false,
          present: !!document.querySelector('#cmp')
        })))
      }
    })

    const { clicked, dismissClicks, present } = await run()
    t.is(clicked, false, `dismiss must not click OK when "${reject}" is present`)
    t.is(dismissClicks, 0, 'dismiss must not register any clicks')
    t.is(present, true, 'CMP dialog must remain for autoconsent')
  })
}

test('re-scans on the post-navigation run for dialogs mounted after the initial scan', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, '<p>no dialog yet</p>')

  const run = browserless.withPage(page => async () => {
    await dismiss.setup(page)
    await page.goto(url)
    /* mount a dialog after setup and re-scan right away: the observer waits
       150ms after a mutation, so a click counted by `run` comes from its own
       re-scan */
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div id="late" role="alertdialog" style="position:fixed;top:20%;left:20%;background:#fff;padding:16px">
           <p>Scheduled maintenance this weekend.</p>
           <button onclick="window.__clicked='ack';document.getElementById('late').remove()">Got it</button>
         </div>`
      )
    })
    return {
      runClicks: await dismiss.run(page),
      clicked: await waitFor(page, () => window.__clicked)
    }
  })

  const { runClicks, clicked } = await run()
  t.is(runClicks, 1, 'the dialog must be clicked by the re-scan itself')
  t.is(clicked, 'ack')
})

test('run resolves the world again when the page navigates between its CDP calls', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, STICKY)

  const run = browserless.withPage(page => async () => {
    await dismiss.setup(page)
    await page.goto(url)
    const client = page._client()
    const send = client.send.bind(client)
    let reloaded = false
    client.send = async (method, ...args) => {
      const response = await send(method, ...args)
      if (method === 'Page.createIsolatedWorld' && !reloaded) {
        reloaded = true
        await page.reload()
      }
      return response
    }
    return dismiss.run(page)
  })

  t.is(await run(), 1)
})

const CMP = `
  <div id="cmp" role="dialog" style="position:fixed;bottom:0;left:0;right:0;background:#fff;padding:16px">
    <p>We use cookies to improve your experience on this website.</p>
    <button type="button" onclick="window.__clicked='reject';document.getElementById('cmp').remove()">Reject all</button>
    <button type="button" onclick="window.__clicked='ok';document.getElementById('cmp').remove()">OK</button>
  </div>`

test('goto lets autoconsent reject a consent dialog while dismiss clicks nothing', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, CMP)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    return {
      clicked: await waitFor(page, () => window.__clicked),
      dismissClicks: await dismiss.run(page)
    }
  })

  const { clicked, dismissClicks } = await run()
  t.is(clicked, 'reject', 'autoconsent must opt out')
  t.is(dismissClicks, 0, 'dismiss must not register any clicks')
})

test('goto lets autoconsent reject a CMP inserted after navigation while dismiss clicks nothing', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, '<p>no dialog yet</p>')

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    await page.evaluate(cmp => document.body.insertAdjacentHTML('beforeend', cmp), CMP)
    return {
      dismissClicks: await dismiss.run(page),
      clicked: await waitFor(page, () => window.__clicked)
    }
  })

  const { clicked, dismissClicks } = await run()
  t.is(clicked, 'reject', 'autoconsent must opt out')
  t.is(dismissClicks, 0, 'dismiss must not register any clicks')
})
