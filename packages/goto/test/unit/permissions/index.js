'use strict'

const { runServer, getBrowserContext, getInternalBrowser } = require('@browserless/test')
const test = require('ava')

const FIXTURE = `<!doctype html>
<title>notifications</title>
<div id="content">content</div>
<script>
  if (Notification.permission === 'default') {
    const overlay = document.createElement('div')
    overlay.id = 'overlay'
    overlay.textContent = 'Subscribe to notifications'
    document.body.appendChild(overlay)
  }
</script>`

const serve = t =>
  runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(FIXTURE)
  })

const readState = page =>
  page.evaluate(async () => ({
    notification: typeof Notification,
    permission: window.Notification?.permission ?? null,
    permissionsQuery: (await navigator.permissions.query({ name: 'notifications' })).state,
    overlay: !!document.getElementById('overlay')
  }))

const readPermission = page =>
  page.evaluate(async () => ({
    permission: window.Notification?.permission ?? null,
    permissionsQuery: (await navigator.permissions.query({ name: 'notifications' })).state
  }))

test('notifications are denied by default', async t => {
  const url = await serve(t)
  const browserless = await getBrowserContext(t)

  t.deepEqual(await browserless.evaluate(readState)(url), {
    notification: 'function',
    permission: 'denied',
    permissionsQuery: 'denied',
    overlay: false
  })
})

test('`notifications` restores the permission prompt', async t => {
  const url = await serve(t)
  const browserless = await getBrowserContext(t)

  t.deepEqual(await browserless.evaluate(readState)(url, { notifications: true }), {
    notification: 'function',
    permission: 'default',
    permissionsQuery: 'prompt',
    overlay: true
  })
})

test('`Notification.requestPermission()` resolves denied', async t => {
  const url = await serve(t)
  const browserless = await getBrowserContext(t)

  const requestPermission = browserless.evaluate(page =>
    page.evaluate(() => window.Notification.requestPermission())
  )

  t.is(await requestPermission(url), 'denied')
})

test('the setting follows the last navigation on a shared context', async t => {
  const url = await serve(t)
  const browserless = await getBrowserContext(t)
  const read = browserless.evaluate(readPermission)

  t.deepEqual(await read(url), { permission: 'denied', permissionsQuery: 'denied' })
  t.deepEqual(await read(url, { notifications: true }), {
    permission: 'default',
    permissionsQuery: 'prompt'
  })
  t.deepEqual(await read(url), { permission: 'denied', permissionsQuery: 'denied' })
})

test('a page of the default browser context is denied too', async t => {
  const url = await serve(t)
  const browserless = await getBrowserContext(t)
  const browser = await getInternalBrowser()
  const page = await browser.newPage()
  t.teardown(() => page.close())

  t.is(page.browserContext().id, undefined)
  await browserless.goto(page, { url })

  t.deepEqual(await readPermission(page), {
    permission: 'denied',
    permissionsQuery: 'denied'
  })
})
