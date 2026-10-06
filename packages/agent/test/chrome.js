'use strict'

const test = require('ava')
const puppeteer = require('puppeteer')
const { observe, execute } = require('../src/browser')
const { StaleDecisionError } = require('../src/errors')

const GENERATED_TEXT = 'bmw x3'

let browser
test.before(async () => {
  browser = await puppeteer.launch({ args: ['--no-sandbox'] })
})
test.after.always(() => browser?.close())

const open = async (t, html) => {
  const page = await browser.newPage()
  t.teardown(() => page.close())
  await page.emulateFocusedPage(true)
  await page.setContent(html)
  return page
}

const fill = async (page, label, text = GENERATED_TEXT) => {
  const state = await observe(page)
  const action = state.actions.find(a => a.kind === 'fill' && a.label === label)
  return execute(page, state, action, text, 0)
}

const REPLACEMENTS_BY_INPUT_TYPE = {
  text: ['old', 'new'],
  search: ['old', 'new'],
  number: ['12', '345'],
  email: ['old@example.com', 'new@example.com'],
  url: ['https://old.example', 'https://new.example'],
  tel: ['111', '222']
}

for (const [type, [previous, next]] of Object.entries(REPLACEMENTS_BY_INPUT_TYPE)) {
  test(`typing replaces the existing value of input type=${type}`, async t => {
    const page = await open(t, `<input type="${type}" aria-label="Field" value="${previous}">`)
    await fill(page, 'Field', next)
    t.is(await page.$eval('input', e => e.value), next)
  })
}

test('input types that cannot take inserted text are never fill targets', async t => {
  const page = await open(
    t,
    ['date', 'time', 'range', 'color'].map(type => `<input type="${type}">`).join('')
  )
  const { actions } = await observe(page)
  t.deepEqual(
    actions.filter(a => a.kind === 'fill'),
    []
  )
})

test('typing replaces the existing value of an input', async t => {
  const page = await open(t, '<input aria-label="Search" value="old">')
  await fill(page, 'Search')
  t.is(await page.$eval('input', e => e.value), GENERATED_TEXT)
})

test('typing replaces the existing content of an editing host', async t => {
  const page = await open(t, '<div contenteditable aria-label="Notes">old <b>text</b></div>')
  await fill(page, 'Notes')
  t.is(await page.$eval('div', e => e.innerText), GENERATED_TEXT)
})

test('typing is discarded when the page moves focus to another control', async t => {
  const page = await open(
    t,
    '<input id="target" aria-label="Search"><input id="thief" aria-label="Other">'
  )
  await page.$eval('#target', e =>
    e.addEventListener('focus', () => document.getElementById('thief').focus())
  )
  await t.throwsAsync(fill(page, 'Search'), { instanceOf: StaleDecisionError })
  t.deepEqual(await page.$$eval('input', inputs => inputs.map(e => e.value)), ['', ''])
})

test('controls that cannot take keyboard text are never fill targets', async t => {
  const page = await open(
    t,
    '<div role="textbox" aria-label="Fake">x</div><div contenteditable aria-label="Host">a <b contenteditable="true" aria-label="Nested">b</b></div>'
  )
  const { actions } = await observe(page)
  t.deepEqual(
    actions.filter(a => a.kind === 'fill').map(a => a.label),
    ['Host']
  )
})

const SHADOW_COMPONENTS = `<script>
  const define = (tag, html) =>
    customElements.define(tag, class extends HTMLElement {
      connectedCallback () {
        this.attachShadow({ mode: 'open' }).innerHTML = html
      }
    })
  define('x-button', '<button><slot></slot></button>')
  define('x-field', '<input aria-label="Search" value="old">')
  define('x-note', '<p>Shadow paragraph</p>')
  define('x-secret', '<input type="password">')
  define('x-outer', '<x-button>Deep</x-button>')
  define('x-icon', '<style>:host { display: inline-block }</style><svg width="8" height="8"></svg>')
</script>`

const act = async (page, kind, label) => {
  const state = await observe(page)
  const action = state.actions.find(a => a.kind === kind && a.label === label)
  return execute(page, state, action, GENERATED_TEXT, 0)
}

const countClicks = page =>
  page.evaluate(() => {
    window.clicks = []
    document.addEventListener('click', event =>
      window.clicks.push(event.composedPath().find(node => node.tagName === 'BUTTON')?.tagName)
    )
  })

test('controls inside open shadow roots are observed with their slotted label', async t => {
  const page = await open(t, `${SHADOW_COMPONENTS}<x-button>Sign in</x-button><x-note></x-note>`)
  const state = await observe(page)
  t.deepEqual(state.unsupported, [])
  t.deepEqual(
    state.actions.filter(a => a.kind === 'click').map(a => [a.role, a.label]),
    [['button', 'Sign in']]
  )
  t.true(state.text.includes('Shadow paragraph'))
})

test('clicking a control inside a shadow root reaches that control', async t => {
  const page = await open(t, `${SHADOW_COMPONENTS}<x-button>Sign in</x-button>`)
  await countClicks(page)
  await act(page, 'click', 'Sign in')
  t.deepEqual(await page.evaluate(() => window.clicks), ['BUTTON'])
})

test('controls in nested shadow roots are observed and clickable', async t => {
  const page = await open(t, `${SHADOW_COMPONENTS}<x-outer></x-outer>`)
  await countClicks(page)
  await act(page, 'click', 'Deep')
  t.deepEqual(await page.evaluate(() => window.clicks), ['BUTTON'])
})

test('typing replaces the value of an input inside a shadow root', async t => {
  const page = await open(t, `${SHADOW_COMPONENTS}<x-field></x-field>`)
  await act(page, 'fill', 'Search')
  t.is(
    await page.$eval('x-field', host => host.shadowRoot.querySelector('input').value),
    GENERATED_TEXT
  )
})

test('a covered control inside a shadow root is stale', async t => {
  const page = await open(t, `${SHADOW_COMPONENTS}<x-button>Sign in</x-button>`)
  const state = await observe(page)
  const action = state.actions.find(a => a.label === 'Sign in')
  await countClicks(page)
  await page.evaluate(() => {
    const cover = document.createElement('div')
    cover.style.cssText = 'position:fixed;inset:0'
    document.body.append(cover)
  })
  await t.throwsAsync(execute(page, state, action, GENERATED_TEXT, 0), {
    instanceOf: StaleDecisionError
  })
  t.deepEqual(await page.evaluate(() => window.clicks), [])
})

test('shadow controls under a hidden or disabled host are not offered', async t => {
  const page = await open(
    t,
    `${SHADOW_COMPONENTS}<x-button aria-hidden="true">Hidden</x-button><x-button aria-disabled="true">Disabled</x-button><x-button inert>Inert</x-button>`
  )
  const { actions } = await observe(page)
  t.deepEqual(
    actions.filter(a => a.kind === 'click'),
    []
  )
})

test('a password field inside a shadow root still blocks as unsupported', async t => {
  const page = await open(t, `${SHADOW_COMPONENTS}<x-secret></x-secret>`)
  t.deepEqual((await observe(page)).unsupported, ['password'])
})

const SEARCH_FORM = `<form><input aria-label="Search" value="bmw x3"></form><input aria-label="Other">
<script>
  window.submissions = 0
  document.querySelector('form').addEventListener('submit', event => {
    event.preventDefault()
    window.submissions++
  })
</script>`

test('submitting a populated field sends Enter to its form', async t => {
  const page = await open(t, SEARCH_FORM)
  await act(page, 'submit', 'Submit Search')
  t.is(await page.evaluate(() => window.submissions), 1)
})

test('submitting is discarded when the page moves focus to another control', async t => {
  const page = await open(t, SEARCH_FORM)
  await page.$eval('input', e =>
    e.addEventListener('focus', () => document.querySelector('[aria-label="Other"]').focus())
  )
  await t.throwsAsync(act(page, 'submit', 'Submit Search'), { instanceOf: StaleDecisionError })
  t.is(await page.evaluate(() => window.submissions), 0)
})

test('a control covered by another element is not offered', async t => {
  const page = await open(
    t,
    '<button>Covered</button><div style="position:fixed;inset:0 0 50% 0"></div><button style="position:fixed;bottom:0">Free</button>'
  )
  const { actions } = await observe(page)
  t.deepEqual(
    actions.filter(a => a.kind === 'click').map(a => a.label),
    ['Free']
  )
})

test('styles inside a shadow root never leak into a control label', async t => {
  const page = await open(t, `${SHADOW_COMPONENTS}<a href="/home"><x-icon></x-icon> Home</a>`)
  const { actions } = await observe(page)
  t.deepEqual(
    actions.filter(a => a.kind === 'click').map(a => a.label),
    ['Home']
  )
})
