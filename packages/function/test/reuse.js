'use strict'

const { getBrowser } = require('@browserless/test')
const path = require('path')
const test = require('ava')

const browserlessFunction = require('..')()

const browserless = getBrowser()

const fileUrl = `file://${path.join(__dirname, './fixtures/example.html')}`

const TITLE_FN = '({ page }) => page.title()'

const spyContext = context => {
  let destroyed = 0
  return {
    calls: () => destroyed,
    context: {
      ...context,
      destroyContext: (...args) => {
        destroyed++
        return context.destroyContext(...args)
      }
    }
  }
}

test('by default the context it created is destroyed', async t => {
  const real = await browserless.createContext()
  const spy = spyContext(real)

  const result = await browserlessFunction(TITLE_FN, {
    getBrowserless: () => ({ createContext: async () => spy.context }),
    timeout: 120000
  })(fileUrl)

  t.true(result.isFulfilled)
  t.is(spy.calls(), 1)
})

test('ownsContext false leaves the context to its owner', async t => {
  const real = await browserless.createContext()
  const spy = spyContext(real)
  t.teardown(() => real.destroyContext())

  const result = await browserlessFunction(TITLE_FN, {
    getBrowserless: () => ({ createContext: async () => spy.context }),
    ownsContext: false,
    timeout: 120000
  })(fileUrl)

  t.true(result.isFulfilled)
  t.is(spy.calls(), 0)
  const page = await real.page('still-open')
  t.false(page.isClosed())
})

test('ownsContext false leaves sibling pages open when the run hits a protocol error', async t => {
  const real = await browserless.createContext()
  t.teardown(() => real.destroyContext())

  const sibling = await real.page('sibling')
  await sibling.goto(fileUrl)

  const error = await t.throwsAsync(
    browserlessFunction(
      '({ page }) => { throw new Error("Protocol error (Page.navigate): forced") }',
      {
        getBrowserless: () => ({ createContext: async () => real }),
        ownsContext: false,
        timeout: 120000
      }
    )(fileUrl)
  )

  t.is(error.code, 'EPROTOCOL')
  t.false(sibling.isClosed())
})

test('getPage runs on the handed-over page without navigating or closing it', async t => {
  const context = await browserless.createContext()
  t.teardown(() => context.destroyContext())

  const page = await context.page('handover')
  await page.goto(fileUrl)
  // A marker only this page carries: a fresh navigation of the same fixture
  // would return the file's own title, so the assertion cannot pass by accident.
  await page.evaluate(() => {
    document.title = 'HANDOVER-MARKER'
  })

  const result = await browserlessFunction(TITLE_FN, {
    getPage: async () => ({ page }),
    timeout: 120000
  })(fileUrl)

  t.true(result.isFulfilled)
  t.is(result.value, 'HANDOVER-MARKER')
  t.false(page.isClosed())
})

test('getPage uses the supplied page when another page is open', async t => {
  const context = await browserless.createContext()
  t.teardown(() => context.destroyContext())

  const marked = await context.page('marked')
  await marked.goto(fileUrl)
  await marked.evaluate(() => {
    document.title = 'HANDOVER-MARKER'
  })

  const other = await context.page('other')
  await other.goto(fileUrl)
  await other.evaluate(() => {
    document.title = 'OTHER-PAGE'
  })

  const result = await browserlessFunction(TITLE_FN, {
    getPage: async () => ({ page: marked }),
    timeout: 120000
  })(fileUrl)

  t.true(result.isFulfilled)
  t.is(result.value, 'HANDOVER-MARKER')
  t.false(marked.isClosed())
  t.false(other.isClosed())
})

test('getPage throws when the supplied page cannot be identified', async t => {
  const context = await browserless.createContext()
  t.teardown(() => context.destroyContext())

  const marked = await context.page('marked')
  await marked.goto(fileUrl)
  await marked.evaluate(() => {
    document.title = 'HANDOVER-MARKER'
  })

  const other = await context.page('other')
  await other.goto(fileUrl)
  await other.evaluate(() => {
    document.title = 'OTHER-PAGE'
  })

  // Fails in the host, before the isolate connects. The isolate miss is the next test.
  marked.createCDPSession = async () => {
    throw new Error('cdp down')
  }

  const error = await t.throwsAsync(
    browserlessFunction(TITLE_FN, {
      getPage: async () => ({ page: marked }),
      timeout: 120000
    })(fileUrl)
  )

  t.is(error.message, 'Could not resolve the supplied page')
  t.false(marked.isClosed())
  t.false(other.isClosed())
})

test('getPage throws when the isolate cannot find the supplied target', async t => {
  const context = await browserless.createContext()
  t.teardown(() => context.destroyContext())

  const marked = await context.page('marked')
  await marked.goto(fileUrl)
  await marked.evaluate(() => {
    document.title = 'HANDOVER-MARKER'
  })

  // The host resolves this id. The isolate then connects to the real browser
  // and finds no such page, so the miss happens after connect, inside the
  // try/finally that disconnects. Using the open page instead would return
  // its title.
  const ghost = {
    browser: () => marked.browser(),
    createCDPSession: async () => ({
      send: async () => ({ targetInfo: { targetId: 'missing-target' } }),
      detach: async () => {}
    })
  }

  const error = await t.throwsAsync(
    browserlessFunction(TITLE_FN, {
      getPage: async () => ({ page: ghost }),
      timeout: 120000
    })(fileUrl)
  )

  t.is(error.message, 'Could not resolve the supplied page')
  t.false(marked.isClosed())
})

test('getPage rejects on timeout and leaves the page open', async t => {
  const context = await browserless.createContext()
  t.teardown(() => context.destroyContext())

  const page = await context.page('hang')
  await page.goto(fileUrl)

  const error = await t.throwsAsync(
    browserlessFunction('({ page }) => page.waitForSelector("#never-matches", { timeout: 0 })', {
      getPage: async () => ({ page }),
      timeout: 500
    })(fileUrl)
  )

  // The timeout ends the wait. The snippet is still blocked on the selector,
  // and the isolate subprocess stays up until the page is closed.
  t.is(error.code, 'EBRWSRTIMEOUT')
  t.false(page.isClosed())
})

test('a supplied page that has gone is asked for again, and the retry succeeds', async t => {
  const context = await browserless.createContext()
  t.teardown(() => context.destroyContext())

  const dead = await context.page('dead')
  await dead.goto(fileUrl)
  await dead.close()

  const live = await context.page('live')
  await live.goto(fileUrl)
  await live.evaluate(() => {
    document.title = 'SECOND-ATTEMPT'
  })

  let calls = 0
  const result = await browserlessFunction(TITLE_FN, {
    getPage: async () => ({ page: calls++ === 0 ? dead : live }),
    retry: 2,
    timeout: 120000
  })(fileUrl)

  t.is(calls, 2)
  t.true(result.isFulfilled)
  t.is(result.value, 'SECOND-ATTEMPT')
  t.false(live.isClosed())
})

test('retry is bounded by the retry option', async t => {
  const context = await browserless.createContext()
  t.teardown(() => context.destroyContext())

  const dead = await context.page('always-dead')
  await dead.goto(fileUrl)
  await dead.close()

  let calls = 0
  await t.throwsAsync(
    browserlessFunction(TITLE_FN, {
      getPage: async () => {
        calls++
        return { page: dead }
      },
      retry: 1,
      timeout: 120000
    })(fileUrl)
  )

  t.is(calls, 2)
})

test('a supplied-page timeout does not start another attempt', async t => {
  const context = await browserless.createContext()
  t.teardown(() => context.destroyContext())

  const dead = await context.page('timed-out')
  await dead.goto(fileUrl)
  await dead.close()

  let release
  const gate = new Promise(resolve => {
    release = resolve
  })
  t.teardown(() => release())

  let calls = 0
  const error = await t.throwsAsync(
    browserlessFunction(TITLE_FN, {
      getPage: async () => {
        calls++
        if (calls === 1) await gate
        return { page: dead }
      },
      retry: 2,
      timeout: 500
    })(fileUrl)
  )

  t.is(error.code, 'EBRWSRTIMEOUT')
  release()

  // The first attempt fails as soon as the gate opens. Without the timeout
  // stop, the retry asks for the page again inside this window, which has to
  // outlast p-retry's backoff before the second attempt is observable: at 500ms
  // this passed with the stop removed, because the retry had not fired yet.
  await new Promise(resolve => setTimeout(resolve, 2500))
  t.is(calls, 1)
})

test('a failed target lookup does not strand a CDP session on a supplied page', async t => {
  const context = await browserless.createContext()
  t.teardown(() => context.destroyContext())

  const page = await context.page('session-leak')
  await page.goto(fileUrl)

  const sessions = []
  const realCreateCDPSession = page.createCDPSession.bind(page)
  page.createCDPSession = async () => {
    const session = await realCreateCDPSession()
    sessions.push(session)
    const realSend = session.send.bind(session)
    session.send = async (...args) =>
      args[0] === 'Target.getTargetInfo'
        ? Promise.reject(new Error('lookup unavailable'))
        : realSend(...args)
    return session
  }

  await t.throwsAsync(
    browserlessFunction(TITLE_FN, {
      getPage: async () => ({ page }),
      retry: 1,
      timeout: 120000
    })(fileUrl)
  )

  t.true(sessions.length >= 1)
  // `detached` is the signal: `connection()` stays truthy after a detach.
  for (const session of sessions) t.true(session.detached)
  t.false(page.isClosed())
})

const KEYS_FN = '({ page, ...args }) => page && Object.keys(args).sort().join(",")'

test('a snippet sees the same arguments on either path', async t => {
  const context = await browserless.createContext()
  t.teardown(() => context.destroyContext())

  const page = await context.page('arg-surface')
  await page.goto(fileUrl)

  const supplied = await browserlessFunction(KEYS_FN, {
    getPage: async () => ({ page }),
    timeout: 120000
  })(fileUrl)

  const navigated = await browserlessFunction(KEYS_FN, {
    getBrowserless: () => browserless,
    timeout: 120000
  })(fileUrl)

  // Internals stay internal: `targetId` and `strictTarget` are how the isolate
  // finds the page, not part of what a snippet is handed.
  t.is(supplied.value, 'device,response,url')
  t.is(supplied.value, navigated.value)
})

test('a supplied page without a device still reports one', async t => {
  const context = await browserless.createContext()
  t.teardown(() => context.destroyContext())

  const page = await context.page('device-derived')
  await page.goto(fileUrl)

  const result = await browserlessFunction(
    '({ page, device }) => page && [typeof device.userAgent, device.viewport.width].join(",")',
    { getPage: async () => ({ page }), timeout: 120000 }
  )(fileUrl)

  t.true(result.isFulfilled)
  const [userAgentType, width] = result.value.split(',')
  t.is(userAgentType, 'string')
  t.is(Number(width), page.viewport().width)
})
