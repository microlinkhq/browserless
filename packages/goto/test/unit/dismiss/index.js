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
    /* settle the scan deterministically instead of waiting a fixed delay */
    await dismiss.run(page)
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
    /* simulate a document where the DOMContentLoaded dismissal never ran */
    const on = page.on.bind(page)
    page.on = (event, handler) => (event === 'domcontentloaded' ? page : on(event, handler))
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
    /* the DOMContentLoaded dismissal is async: settle it before asserting */
    await dismiss.run(page)
    const clicked = await waitFor(page, () => window.__clicked)
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
    /* settle the instance first: the DOMContentLoaded dismissal can still be in
       flight when the navigation resolves, and its initial scan would click the
       dialog before any re-scan */
    await dismiss.run(page)
    /* mount a dialog and re-scan right away: the observer waits 150ms after a
       mutation, so a click counted by `run` comes from its own re-scan */
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

test('creates the dismiss world only in the top frame', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(
    t,
    DIALOG +
      '<iframe srcdoc="<p>one</p>"></iframe><iframe srcdoc="<p>two</p>"></iframe><iframe srcdoc="<p>three</p>"></iframe>'
  )

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    const clicked = await waitFor(page, () => window.__clicked)
    /* wait for every child frame to attach before counting worlds */
    for (let attempt = 0; attempt < 50 && page.frames().length < 4; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    const session = await page.createCDPSession()
    const worldNames = []
    session.on('Runtime.executionContextCreated', ({ context }) => worldNames.push(context.name))
    await session.send('Runtime.enable')
    await session.detach()
    return {
      clicked,
      frames: page.frames().length,
      dismissWorlds: worldNames.filter(name => name === dismiss.WORLD_NAME).length
    }
  })

  const { clicked, frames, dismissWorlds } = await run()
  t.is(clicked, 'ack')
  t.is(frames, 4)
  t.is(dismissWorlds, 1, 'child frames must not get a dismiss world')
})

test('dismisses a page whose element id clobbers the guard name', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, '<div id="__browserlessDismiss"></div>' + DIALOG)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    return waitFor(page, () => window.__clicked)
  })

  t.is(await run(), 'ack')
})

const dismissOnGoto = (browserless, url) =>
  browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    return {
      clicked: await waitFor(page, () => window.__clicked),
      runClicks: await dismiss.run(page)
    }
  })()

/* HTMLFormElement named access shadows builtins on the <form> itself: a named
   control shadows a <form> dialog's methods, and a named <img> shadows a
   <form role="button">'s, so the dismissal must never read them off the element */
const formDialog = method =>
  `<form role="dialog" style="position:fixed;top:20%;left:20%;background:#fff;padding:16px" onsubmit="return false">
     <p>Scheduled maintenance this weekend.</p>
     <button type="button" name="${method}" onclick="window.__clicked='ack'">OK</button>
   </form>`

for (const method of ['getClientRects', 'querySelector', 'querySelectorAll']) {
  test(`clicks a form dialog whose button shadows ${method}`, async t => {
    const browserless = await getBrowserContext(t)
    const url = await serve(t, formDialog(method))

    const { clicked, runClicks } = await dismissOnGoto(browserless, url)
    t.is(clicked, 'ack')
    t.is(runClicks, 1)
  })

  test(`clicks a late form dialog whose button shadows ${method}`, async t => {
    const browserless = await getBrowserContext(t)
    const url = await serve(
      t,
      `<script>setTimeout(() => document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(
        formDialog(method)
      )}), 500)</script>`
    )

    const { clicked } = await dismissOnGoto(browserless, url)
    t.is(clicked, 'ack')
  })
}

const formButton = (method, attributes = '') =>
  `<div role="dialog" style="position:fixed;top:20%;left:20%;background:#fff;padding:16px">
     <p>Scheduled maintenance this weekend.</p>
     <form role="button" ${attributes} style="display:inline-block" onclick="window.__clicked='ack'"><span>OK</span><img name="${method}" width="1" height="1"></form>
   </div>`

/* closest is only read for a button labelled as a close control */
const FORM_BUTTON_CASES = [
  { method: 'getClientRects' },
  { method: 'innerText' },
  { method: 'getAttribute' },
  { method: 'closest', attributes: 'aria-label="Close"' },
  { method: 'click' }
]

for (const { method, attributes } of FORM_BUTTON_CASES) {
  test(`clicks a form button that shadows ${method}`, async t => {
    const browserless = await getBrowserContext(t)
    const url = await serve(t, formButton(method, attributes))

    const { clicked, runClicks } = await dismissOnGoto(browserless, url)
    t.is(clicked, 'ack')
    t.is(runClicks, 1)
  })
}

test('keeps scanning past a dialog whose button still throws', async t => {
  const browserless = await getBrowserContext(t)
  /* an empty <form role="button"> falls back to `value`, which a named <img>
     turns into an element, so reading its text throws inside the dismissal */
  const url = await serve(
    t,
    `<div role="dialog" style="position:fixed;top:60%;left:20%;background:#fff;padding:16px">
       <p>Newsletter</p>
       <form role="button" style="display:inline-block"><img name="value" width="1" height="1"></form>
     </div>` + DIALOG
  )

  const { clicked, runClicks } = await dismissOnGoto(browserless, url)
  t.is(clicked, 'ack', 'a throwing dialog must not stop the scan')
  t.is(runClicks, 1)
})

const nonHtmlButtonDialog = button =>
  `<div role="dialog" style="position:fixed;top:20%;left:20%;background:#fff;padding:16px">
     <p>Scheduled maintenance this weekend.</p>
     ${button}
     <button type="button" onclick="window.__clicked='ack'">OK</button>
   </div>`

/* non-HTML elements read as empty text and cannot be clicked, so none of them
   may take the acknowledge button's place or abort the dialog */
const NON_HTML_BUTTONS = [
  {
    name: 'an SVG button without text',
    markup: '<svg role="button" width="24" height="24"><rect width="24" height="24"></rect></svg>'
  },
  {
    name: 'an SVG button titled "Close"',
    markup:
      '<svg role="button" width="24" height="24"><title>Close</title><rect width="24" height="24"></rect></svg>'
  },
  {
    name: 'an SVG button titled "Decline"',
    markup:
      '<svg role="button" width="24" height="24"><title>Decline</title><rect width="24" height="24"></rect></svg>'
  },
  {
    name: 'an SVG button labelled "Close"',
    markup:
      '<svg role="button" aria-label="Close" width="24" height="24"><rect width="24" height="24"></rect></svg>'
  },
  { name: 'a MathML button reading "x"', markup: '<math><mi role="button">x</mi></math>' }
]

for (const { name, markup } of NON_HTML_BUTTONS) {
  test(`clicks the acknowledge button next to ${name}`, async t => {
    const browserless = await getBrowserContext(t)
    const url = await serve(t, nonHtmlButtonDialog(markup))

    const { clicked, runClicks } = await dismissOnGoto(browserless, url)
    t.is(clicked, 'ack')
    t.is(runClicks, 1, 'only the real click counts')
  })
}

test('does not count unclickable SVG close buttons toward the click limit', async t => {
  const browserless = await getBrowserContext(t)
  const svgCloseDialog = top =>
    `<div role="dialog" style="position:fixed;top:${top}%;left:10%;background:#fff;padding:16px">
       <svg role="button" aria-label="Close" width="24" height="24"><rect width="24" height="24"></rect></svg>
     </div>`
  const url = await serve(t, [10, 20, 30].map(svgCloseDialog).join('') + DIALOG)

  const { clicked, runClicks } = await dismissOnGoto(browserless, url)
  t.is(clicked, 'ack', 'three unclickable dialogs must not exhaust the click limit')
  t.is(runClicks, 1)
})

test('runs the DOMContentLoaded dismissal once per document', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(
    t,
    STICKY + '<iframe srcdoc="<p>one</p>"></iframe><iframe srcdoc="<p>two</p>"></iframe>'
  )

  const run = browserless.withPage((page, goto) => async () => {
    for (let navigation = 0; navigation < 3; navigation++) await goto(page, { url })
    const client = page._client()
    const send = client.send.bind(client)
    let dismissWorldRequests = 0
    client.send = (method, params, ...rest) => {
      if (method === 'Page.createIsolatedWorld' && params?.worldName === dismiss.WORLD_NAME) {
        dismissWorldRequests++
      }
      return send(method, params, ...rest)
    }
    await page.reload()
    await new Promise(resolve => setTimeout(resolve, 500))
    return dismissWorldRequests
  })

  t.is(await run(), 1)
})

test('keeps dismissing after a prerender activation swaps the CDP session', async t => {
  const browserless = await getBrowserContext(t)
  /* a Preload.enable session disables prerendering, so wait for the
     prerendered document's own load event (beaconed via fetch) instead: it is
     ready to activate only once fully loaded, otherwise the navigation is a
     plain load with no session swap */
  let onPrerenderReady
  const prerenderReady = new Promise(resolve => {
    onPrerenderReady = resolve
  })
  const url = await runServer(t, ({ req, res }) => {
    if (req.url === '/prerender-ready') {
      onPrerenderReady()
      return res.end()
    }
    res.setHeader('content-type', 'text/html')
    if (req.url === '/sticky?prerendered') {
      return res.end(
        page(STICKY + '<script>addEventListener("load", () => fetch("/prerender-ready"))</script>')
      )
    }
    if (req.url.startsWith('/sticky')) return res.end(page(STICKY))
    res.end(
      page(
        '<script type="speculationrules">{"prerender":[{"source":"list","urls":["/sticky?prerendered"],"eagerness":"immediate"}]}</script>'
      )
    )
  })

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    await prerenderReady
    const clientBeforeActivation = page._client()
    await Promise.all([
      page.waitForNavigation(),
      page.evaluate(() => {
        window.location.href = '/sticky?prerendered'
      })
    ])
    const activated = await page.evaluate(
      () => performance.getEntriesByType('navigation')[0].activationStart > 0
    )
    await page.goto(new URL('/sticky?after-activation', url).toString())
    return {
      activated,
      swapped: page._client() !== clientBeforeActivation,
      clicks: await waitFor(page, () => window.__clicks)
    }
  })

  const { activated, swapped, clicks } = await run()
  t.true(activated, 'the prerendered page must be activated')
  t.true(swapped, 'the activation must swap the CDP session')
  t.is(clicks, 1, 'a navigation outside goto must still be dismissed')
})

const fakePage = respond => {
  const methods = []
  const client = {
    send: async method => {
      methods.push(method)
      return respond(method, methods)
    }
  }
  return { methods, page: { _client: () => client, mainFrame: () => ({ _id: 'main' }) } }
}

test('run does not retry protocol errors other than a stale context', async t => {
  const { methods, page } = fakePage(() => {
    throw new Error('Protocol error (Page.createIsolatedWorld): Target closed')
  })

  await t.throwsAsync(dismiss.run(page), { message: /Target closed/ })
  t.deepEqual(methods, ['Page.createIsolatedWorld'])
})

/* every message Chromium uses for a context lost to a mid-call navigation */
const STALE_CONTEXT_MESSAGES = [
  'Protocol error (Runtime.evaluate): Cannot find context with specified id',
  'Protocol error (Runtime.evaluate): Inspected target navigated or closed',
  'Protocol error (Runtime.evaluate): Execution context was destroyed.'
]

for (const message of STALE_CONTEXT_MESSAGES) {
  test(`run retries after "${message.replace(
    /^Protocol error \(Runtime\.evaluate\): /,
    ''
  )}"`, async t => {
    const { methods, page } = fakePage((method, sent) => {
      if (method === 'Page.createIsolatedWorld') return { executionContextId: sent.length }
      if (sent.filter(name => name === 'Runtime.evaluate').length < 3) throw new Error(message)
      return { result: { value: 1 } }
    })

    t.is(await dismiss.run(page), 1)
    t.is(methods.length, 6)
  })
}

test('run does not retry page exceptions that look like a stale context', async t => {
  const { methods, page } = fakePage(method =>
    method === 'Page.createIsolatedWorld'
      ? { executionContextId: 1 }
      : {
          result: {},
          exceptionDetails: {
            text: 'Uncaught',
            exception: { description: 'Error: Cannot find context' }
          }
        }
  )

  await t.throwsAsync(dismiss.run(page), { message: 'Error: Cannot find context' })
  t.deepEqual(methods, ['Page.createIsolatedWorld', 'Runtime.evaluate'])
})
