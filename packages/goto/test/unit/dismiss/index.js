'use strict'

const test = require('ava')

const { runServer, getBrowserContext } = require('@browserless/test')

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

const DIALOG = `
  <div id="notice" role="alertdialog" style="position:fixed;top:20%;left:20%;background:#fff;padding:16px;z-index:9999">
    <h2>Important Notice</h2>
    <p>We will be removing the following works from our website.</p>
    <button onclick="window.__clicked='ack';document.getElementById('notice').remove()">I understand</button>
  </div>`

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
    return page.evaluate(() => ({
      clicked: window.__clicked || false,
      injected: window.__browserlessDismiss !== undefined
    }))
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
    page.evaluateOnNewDocument = async () => {}
    await goto(page, { url })
    return waitFor(page, () => window.__clicked)
  })

  t.is(await run(), 'ack')
})

/* inject after goto so only dismiss's re-scan runs on it, isolating the
   consent guard from autoconsent (which legitimately handles such dialogs) */
test('dismiss leaves cookie-consent dialogs to autoconsent', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, '<p>no dialog yet</p>')

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    return page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div id="consent" role="dialog" style="position:fixed;bottom:0;left:0;right:0;background:#fff;padding:16px">
           <p>We use cookies to improve your experience on this website.</p>
           <button type="button" onclick="window.__clicked='ok';document.getElementById('consent').remove()">OK</button>
         </div>`
      )
      window.__browserlessDismiss.rescan()
      return { clicked: window.__clicked || false, present: !!document.querySelector('#consent') }
    })
  })

  const { clicked, present } = await run()
  t.is(clicked, false, 'dismiss must not click a consent dialog')
  t.is(present, true, 'consent dialog must remain for autoconsent')
})

test('dismiss leaves CMP dialogs with a reject button to autoconsent', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, '<p>no dialog yet</p>')

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    return page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div id="cmp" role="dialog" style="position:fixed;bottom:0;left:0;right:0;background:#fff;padding:16px">
           <p>We need your permission to track you across the web.</p>
           <button type="button" onclick="window.__clicked='reject';document.getElementById('cmp').remove()">Reject all</button>
           <button type="button" onclick="window.__clicked='ok';document.getElementById('cmp').remove()">OK</button>
         </div>`
      )
      window.__browserlessDismiss.rescan()
      return {
        clicked: window.__clicked || false,
        dismissClicks: window.__browserlessDismiss.clicked,
        present: !!document.querySelector('#cmp')
      }
    })
  })

  const { clicked, dismissClicks, present } = await run()
  t.is(clicked, false, 'dismiss must not click OK when a reject button is present')
  t.is(dismissClicks, 0, 'dismiss must not register any clicks')
  t.is(present, true, 'CMP dialog must remain for autoconsent')
})

test('dismiss leaves CMP dialogs with a reject button before consent copy loads', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, '<p>no dialog yet</p>')

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    return page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div id="cmp" role="dialog" style="position:fixed;bottom:0;left:0;right:0;background:#fff;padding:16px">
           <button type="button" onclick="window.__clicked='reject';document.getElementById('cmp').remove()">Reject all</button>
           <button type="button" onclick="window.__clicked='ok';document.getElementById('cmp').remove()">OK</button>
         </div>`
      )
      window.__browserlessDismiss.rescan()
      return {
        clicked: window.__clicked || false,
        dismissClicks: window.__browserlessDismiss.clicked,
        present: !!document.querySelector('#cmp')
      }
    })
  })

  const { clicked, dismissClicks, present } = await run()
  t.is(clicked, false, 'dismiss must not click OK before consent copy is present')
  t.is(dismissClicks, 0, 'dismiss must not register any clicks')
  t.is(present, true, 'CMP dialog must remain for autoconsent')
})

test('dismiss leaves CMP dialogs whose reject button includes the "cookies" suffix', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, '<p>no dialog yet</p>')

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    return page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div id="cmp" role="dialog" style="position:fixed;bottom:0;left:0;right:0;background:#fff;padding:16px">
           <p>We need your permission to track you across the web.</p>
           <button type="button" onclick="window.__clicked='reject';document.getElementById('cmp').remove()">Reject all cookies</button>
           <button type="button" onclick="window.__clicked='ok';document.getElementById('cmp').remove()">OK</button>
         </div>`
      )
      window.__browserlessDismiss.rescan()
      return {
        clicked: window.__clicked || false,
        dismissClicks: window.__browserlessDismiss.clicked,
        present: !!document.querySelector('#cmp')
      }
    })
  })

  const { clicked, dismissClicks, present } = await run()
  t.is(clicked, false, 'dismiss must not click OK when "Reject all cookies" is present')
  t.is(dismissClicks, 0, 'dismiss must not register any clicks')
  t.is(present, true, 'CMP dialog must remain for autoconsent')
})

test('dismiss leaves a German CMP with an "Ablehnen" reject button to autoconsent', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, '<p>no dialog yet</p>')

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    return page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div id="cmp" role="dialog" style="position:fixed;bottom:0;left:0;right:0;background:#fff;padding:16px">
           <p>Wir und unsere Partner verarbeiten Daten fuer Werbung.</p>
           <button type="button" onclick="window.__clicked='reject';document.getElementById('cmp').remove()">Ablehnen</button>
           <button type="button" onclick="window.__clicked='ok';document.getElementById('cmp').remove()">OK</button>
         </div>`
      )
      window.__browserlessDismiss.rescan()
      return {
        clicked: window.__clicked || false,
        dismissClicks: window.__browserlessDismiss.clicked,
        present: !!document.querySelector('#cmp')
      }
    })
  })

  const { clicked, dismissClicks, present } = await run()
  t.is(clicked, false, 'dismiss must not click OK when "Ablehnen" is present')
  t.is(dismissClicks, 0, 'dismiss must not register any clicks')
  t.is(present, true, 'CMP dialog must remain for autoconsent')
})

test('dismiss leaves a French CMP with a "Continuer sans accepter" button to autoconsent', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, '<p>no dialog yet</p>')

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    return page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div id="cmp" role="dialog" style="position:fixed;bottom:0;left:0;right:0;background:#fff;padding:16px">
           <p>Nous et nos partenaires suivons votre navigation.</p>
           <button type="button" onclick="window.__clicked='reject';document.getElementById('cmp').remove()">Continuer sans accepter</button>
           <button type="button" onclick="window.__clicked='ok';document.getElementById('cmp').remove()">OK</button>
         </div>`
      )
      window.__browserlessDismiss.rescan()
      return {
        clicked: window.__clicked || false,
        dismissClicks: window.__browserlessDismiss.clicked,
        present: !!document.querySelector('#cmp')
      }
    })
  })

  const { clicked, dismissClicks, present } = await run()
  t.is(clicked, false, 'dismiss must not click OK when "Continuer sans accepter" is present')
  t.is(dismissClicks, 0, 'dismiss must not register any clicks')
  t.is(present, true, 'CMP dialog must remain for autoconsent')
})

test('re-scans on the post-navigation run for dialogs mounted after the initial scan', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, '<p>no dialog yet</p>')

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    /* mount a dialog after setup, then trigger the same re-scan the run
       fallback performs once goto resolves */
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div id="late" role="alertdialog" style="position:fixed;top:20%;left:20%;background:#fff;padding:16px">
           <p>Scheduled maintenance this weekend.</p>
           <button onclick="window.__clicked='ack';document.getElementById('late').remove()">Got it</button>
         </div>`
      )
      window.__browserlessDismiss.rescan()
    })
    return waitFor(page, () => window.__clicked)
  })

  t.is(await run(), 'ack')
})
