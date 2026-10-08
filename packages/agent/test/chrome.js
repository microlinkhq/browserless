'use strict'

const { createServer } = require('node:http')
const test = require('ava')
const puppeteer = require('puppeteer')
const { observe, execute, settle, settled, pageOutline, agentWorld } = require('../src/browser')
const { applyRules } = require('../src/rules')
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

test('viewport text keeps what is on screen, including a fixed banner', async t => {
  const page = await open(
    t,
    `<p>Visible intro</p>
     <div style="position:fixed;top:8px;left:8px">Fixed banner</div>
     <div style="height:4000px"></div>
     <p>Below the fold paragraph</p>`
  )
  const { text } = await observe(page)
  t.true(text.includes('Visible intro'))
  t.true(text.includes('Fixed banner'))
  t.false(text.includes('Below the fold paragraph'))
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

test('a page script cannot swap the node the agent clicks', async t => {
  const page = await open(t, '<button id="ok">Ok</button><button id="bad">Bad</button>')
  await page.evaluate(() => {
    for (const id of ['ok', 'bad']) {
      document.getElementById(id).addEventListener('click', () => {
        window.clicked = id
      })
    }
  })
  const state = await observe(page)
  const action = state.actions.find(item => item.kind === 'click' && item.label === 'Ok')
  await page.evaluate(() => {
    window.__browserlessAgent = {
      nodes: { get: () => document.getElementById('bad') },
      guard: () => null,
      contains: () => true,
      elementFromPoint: () => document.getElementById('bad'),
      closest: () => null,
      activeElement: () => document.getElementById('bad')
    }
  })
  await execute(page, state, action, undefined, 0)
  t.is(await page.evaluate(() => window.clicked), 'ok')
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

test('a control that disables itself is observed after it is enabled again', async t => {
  const page = await open(
    t,
    `<button id="save" type="button">Save</button><p id="done" hidden>Saved</p>
     <script>
       document.getElementById('save').addEventListener('click', () => {
         const button = document.getElementById('save')
         button.disabled = true
         setTimeout(() => {
           button.disabled = false
           document.getElementById('done').hidden = false
         }, 400)
       })
     </script>`
  )
  const state = await observe(page)
  const action = state.actions.find(item => item.kind === 'click' && item.label === 'Save')
  const started = Date.now()
  await execute(page, state, action, undefined, 0)
  await settle(page, action)
  const next = await observe(page)
  t.true(next.text.includes('Saved'))
  t.true(Date.now() - started >= 350, `observed after ${Date.now() - started} ms`)
  t.false(await page.$eval('#save', element => element.disabled))
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

const SETTLE_LIMITS = { autocompleteMs: 1500, defaultMs: 50, minFrames: 2 }
const CLEARLY_BEFORE_AUTOCOMPLETE_LIMIT_MS = 1000
const SUGGESTION_DELAY_MS = 200

const COMBOBOX =
  '<input role="combobox" aria-label="City" aria-controls="suggestions"><ul id="suggestions"></ul>'

const settleMs = async (page, kind, label, before) => {
  const { actions } = await observe(page)
  const action = actions.find(a => a.kind === kind && a.label === label)
  if (before) await before()
  const started = Date.now()
  await agentWorld(page).evaluate(settled, action, SETTLE_LIMITS)
  return Date.now() - started
}

// Arm the insert from the world that settles, on the first read of the field,
// so the option cannot exist before that read no matter how slow the runner is.
const revealSuggestionWhenRead = page =>
  agentWorld(page).evaluate(delay => {
    const field = document.querySelector('[role="combobox"]')
    const original = field.getAttribute.bind(field)
    field.getAttribute = name => {
      if (!field.dataset.revealArmed) {
        field.dataset.revealArmed = '1'
        setTimeout(() => {
          document.getElementById('suggestions').innerHTML = '<li role="option">Zurich</li>'
        }, delay)
      }
      return original(name)
    }
  }, SUGGESTION_DELAY_MS)

test('settling after typing in a combobox waits for its suggestions to appear', async t => {
  const page = await open(t, COMBOBOX)
  const elapsed = await settleMs(page, 'fill', 'City', () => revealSuggestionWhenRead(page))
  t.is(await page.$eval('#suggestions', list => list.textContent), 'Zurich')
  t.true(elapsed < SETTLE_LIMITS.autocompleteMs, `settled after ${elapsed} ms`)
})

test('settling after typing in a combobox ignores options already on screen', async t => {
  const page = await open(
    t,
    '<div role="option">Leftover</div><input role="combobox" aria-label="City"><ul id="suggestions"></ul>'
  )
  const elapsed = await settleMs(page, 'fill', 'City', () => revealSuggestionWhenRead(page))
  t.is(await page.$eval('#suggestions', list => list.textContent), 'Zurich')
  t.true(elapsed >= SUGGESTION_DELAY_MS - 40, `settled after ${elapsed} ms`)
  t.true(elapsed < SETTLE_LIMITS.autocompleteMs, `settled after ${elapsed} ms`)
})

test('settling after typing in a combobox gives up at the autocomplete limit', async t => {
  const page = await open(t, COMBOBOX)
  const elapsed = await settleMs(page, 'fill', 'City')
  t.true(elapsed >= SETTLE_LIMITS.autocompleteMs - 20, `settled after ${elapsed} ms`)
})

test('settling after a click does not wait for suggestions', async t => {
  const page = await open(t, `${COMBOBOX}<button>Go</button>`)
  const elapsed = await settleMs(page, 'click', 'Go')
  t.true(elapsed < CLEARLY_BEFORE_AUTOCOMPLETE_LIMIT_MS, `settled after ${elapsed} ms`)
})

const BODY_RETURNS_AFTER_MS = 200

test('observing a document that has no body yet waits for the body', async t => {
  const page = await open(t, '<button>Ready</button>')
  await page.evaluate(delay => {
    const body = document.body
    body.remove()
    setTimeout(() => document.documentElement.append(body), delay)
  }, BODY_RETURNS_AFTER_MS)
  const { actions } = await observe(page)
  t.deepEqual(
    actions.filter(a => a.kind === 'click').map(a => a.label),
    ['Ready']
  )
})

test('observing a document that never gets a body is blocked', async t => {
  const page = await open(t, '<button>Gone</button>')
  await page.evaluate(() => document.body.remove())
  const error = await t.throwsAsync(observe(page))
  t.is(error.reason, 'unsupported_surface')
})

const BODY_SENT_AFTER_MS = 200

const pageWithLateBody = async (t, body) => {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html')
    response.write('<!doctype html><html><head><title>Loading</title></head>')
    setTimeout(() => response.end(`<body>${body}</body></html>`), BODY_SENT_AFTER_MS)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.teardown(() => server.close())
  return `http://127.0.0.1:${server.address().port}/`
}

test('observing right after a click that navigates waits for the new page body', async t => {
  const destination = await pageWithLateBody(t, '<button>Arrived</button>')
  const page = await open(t, `<a href="${destination}">Leave</a>`)
  const responded = page.waitForResponse(destination)
  await act(page, 'click', 'Leave')
  await responded
  const { actions } = await observe(page)
  t.deepEqual(
    actions.filter(a => a.kind === 'click').map(a => a.label),
    ['Arrived']
  )
})

const STORIES = `
  <h1>Top stories</h1>
  <table>
    <tr class="athing"><td><span class="titleline"><a href="/item?id=1">  First   story </a></span><span class="score">120 points</span></td></tr>
    <tr class="athing"><td><span class="titleline"><a href="https://other.example/2">Second story</a></span></td></tr>
  </table>
  <img id="avatar" src="/avatar.png" alt="Avatar">
  <input id="query" value="bmw x3">
  <time datetime="2026-10-06T10:00:00Z">today</time>`

const withBase = html => `<base href="https://news.example/">${html}`

test('rules read one element, one attribute and a typed value', async t => {
  const page = await open(t, withBase(STORIES))
  t.deepEqual(
    await applyRules(page, {
      heading: { selector: 'h1', attr: 'text' },
      avatar: { selector: '#avatar', attr: 'src', type: 'image' },
      avatarAttribute: { selector: '#avatar', attr: 'src' },
      alt: { selector: '#avatar', attr: 'alt' },
      query: { selector: '#query', attr: 'val' },
      published: { selector: 'time', attr: 'datetime', type: 'date' },
      score: { selector: '.score', attr: 'text', type: 'number' }
    }),
    {
      heading: 'Top stories',
      avatar: 'https://news.example/avatar.png',
      avatarAttribute: '/avatar.png',
      alt: 'Avatar',
      query: 'bmw x3',
      published: '2026-10-06T10:00:00.000Z',
      score: 120
    }
  )
})

test('selectorAll with nested rules gives one object per element, null where a field is missing', async t => {
  const page = await open(t, withBase(STORIES))
  t.deepEqual(
    await applyRules(page, {
      stories: {
        selectorAll: '.athing',
        attr: {
          title: { selector: '.titleline > a', attr: 'text' },
          href: { selector: '.titleline > a', attr: 'href', type: 'url' },
          score: { selector: '.score', attr: 'text', type: 'number' }
        }
      }
    }),
    {
      stories: [
        { title: 'First story', href: 'https://news.example/item?id=1', score: 120 },
        { title: 'Second story', href: 'https://other.example/2', score: null }
      ]
    }
  )
})

test('a field whose selector matches nothing is left out', async t => {
  const page = await open(t, STORIES)
  t.deepEqual(
    await applyRules(page, {
      heading: { selector: 'h1', attr: 'text' },
      missing: { selector: '.nope', attr: 'text' },
      missingList: { selectorAll: '.nope', attr: 'text' }
    }),
    { heading: 'Top stories' }
  )
})

test('alternative rules, selectors and attributes fall back in order', async t => {
  const page = await open(t, STORIES)
  t.deepEqual(
    await applyRules(page, {
      heading: [
        { selector: '.nope', attr: 'text' },
        { selector: 'h1', attr: 'text' }
      ],
      title: { selector: ['.nope', '.titleline > a'], attr: 'text' },
      label: { selector: '#avatar', attr: ['title', 'alt'] }
    }),
    { heading: 'Top stories', title: 'First story', label: 'Avatar' }
  )
})

test('a list drops repeated values and a rule without attr reads the html', async t => {
  const page = await open(t, '<ul><li><b>a</b></li><li><b>a</b></li><li><b>b</b></li></ul>')
  t.deepEqual(
    await applyRules(page, {
      letters: { selectorAll: 'li', attr: 'text' },
      first: { selector: 'li' }
    }),
    { letters: ['a', 'b'], first: '<b>a</b>' }
  )
})

for (const [text, expected] of [
  ['6999 €', 6999],
  ['16.690 €', 16690],
  ['1.234.567', 1234567],
  ['1,234.50 USD', 1234.5],
  ['1.234,50 €', 1234.5],
  ['4.5 stars', 4.5],
  ['0 €', 0],
  ['-12', -12],
  ['0.125', 0.125],
  ['0,5', 0.5],
  ['4.5 (1,234 reviews)', 4.5],
  ['\u22125 °C', -5],
  ['1e3', 1],
  ['3\u20135', 3],
  ['3.142', 3142]
]) {
  test(`number type reads ${text} as ${expected}`, async t => {
    const page = await open(t, `<p>${text}</p>`)
    t.deepEqual(
      await applyRules(page, { value: { selector: 'p', attr: 'text', type: 'number' } }),
      {
        value: expected
      }
    )
  })
}

test('a value that does not fit its type is left out', async t => {
  const page = await open(t, '<p>soon</p><a href="javascript:alert(1)">x</a>')
  t.deepEqual(
    await applyRules(page, {
      number: { selector: 'p', attr: 'text', type: 'number' },
      date: { selector: 'p', attr: 'text', type: 'date' },
      url: { selector: 'a', attr: 'href', type: 'url' }
    }),
    {}
  )
})

const OUTLINE_LIMITS = { characters: 60000, text: 80, attribute: 80, siblings: 3 }

test('page outline shows tags, useful attributes and short text, indented by nesting', async t => {
  const page = await open(
    t,
    '<main id="results"><article class="card" data-id="7" style="color:red"><a href="/item/7">BMW X3</a><span class="price">6999 €</span></article></main>'
  )
  const { outline, url, title } = await page.evaluate(pageOutline, OUTLINE_LIMITS)
  t.is(
    outline,
    [
      '<body>',
      '  <main id="results">',
      '    <article class="card" data-id="7">',
      '      <a href="/item/7"> BMW X3',
      '      <span class="price"> 6999 €'
    ].join('\n')
  )
  t.is(url, 'about:blank')
  t.is(title, '')
})

test('page outline keeps the first similar siblings and counts the rest', async t => {
  const cards = Array.from({ length: 10 }, (_, i) => `<li class="card">Item ${i}</li>`).join('')
  const page = await open(t, `<ul>${cards}</ul>`)
  const { outline } = await page.evaluate(pageOutline, OUTLINE_LIMITS)
  t.is(
    outline,
    [
      '<body>',
      '  <ul>',
      '    <li class="card"> Item 0',
      '    <li class="card"> Item 1',
      '    <li class="card"> Item 2',
      '    <!-- 7 more <li> like the ones above -->'
    ].join('\n')
  )
})

test('page outline leaves out hidden elements, scripts, styles and long values', async t => {
  const page = await open(
    t,
    `<p hidden>Hidden</p><p aria-hidden="true">Decorative</p><script>window.x = 1</script><style>p{}</style><p title="${'t'.repeat(
      200
    )}">${'word '.repeat(60)}</p>`
  )
  const { outline } = await page.evaluate(pageOutline, OUTLINE_LIMITS)
  const [body, paragraph, ...rest] = outline.split('\n')
  t.is(body, '<body>')
  t.deepEqual(rest, [])
  t.true(paragraph.includes(`title="${'t'.repeat(80)}…"`))
  t.true(paragraph.endsWith('…'))
})

test('page outline stops at the character limit', async t => {
  const page = await open(t, `<div>${'<p>text</p>'.repeat(50)}</div>`)
  const { outline } = await page.evaluate(pageOutline, {
    ...OUTLINE_LIMITS,
    characters: 40,
    siblings: 50
  })
  t.true(outline.length <= 40)
})

test('an invalid selector is reported instead of crashing the page script', async t => {
  const page = await open(t, STORIES)
  await t.throwsAsync(
    applyRules(page, {
      heading: { selector: 'h1', attr: 'text' },
      broken: { selector: '#4 9977979 .titleline a', attr: 'text' }
    }),
    { message: 'Invalid CSS selector: #4 9977979 .titleline a' }
  )
})

for (const text of ['12.34.56', 'v2.10.3', 'soon']) {
  test(`number type gives nothing for ${text}`, async t => {
    const page = await open(t, `<p>${text}</p>`)
    t.deepEqual(
      await applyRules(page, { value: { selector: 'p', attr: 'text', type: 'number' } }),
      {}
    )
  })
}

test('an untyped value that looks like a number or boolean is converted, a string type keeps it', async t => {
  const page = await open(t, '<p id="n">42</p><p id="b">true</p><p id="s">BMW X3 2006</p>')
  t.deepEqual(
    await applyRules(page, {
      number: { selector: '#n', attr: 'text' },
      boolean: { selector: '#b', attr: 'text' },
      text: { selector: '#s', attr: 'text' },
      kept: { selector: '#n', attr: 'text', type: 'string' }
    }),
    { number: 42, boolean: true, text: 'BMW X3 2006', kept: '42' }
  )
})

test('type names that exist on every object are not treated as converters', async t => {
  const page = await open(t, '<p>hi</p>')
  for (const type of ['constructor', 'isPrototypeOf', 'valueOf', '__proto__', 'toString']) {
    t.deepEqual(await applyRules(page, { value: { selector: 'p', attr: 'text', type } }), {
      value: 'hi'
    })
  }
})

test('an empty href is a missing value', async t => {
  const page = await open(t, '<a href="">x</a>')
  t.deepEqual(await applyRules(page, { link: { selector: 'a', attr: 'href' } }), {})
})

const CARDS = `
  <b class="t">outside</b>
  <ul>
    <li><a href="/1">One</a><span><a href="/deep">Deep</a></span></li>
    <li><a href="/1">One</a><span><a href="/deep">Deep</a></span></li>
  </ul>`

test('nested rules are relative to the item and keep identical items', async t => {
  const page = await open(t, CARDS)
  t.deepEqual(
    await applyRules(page, {
      items: {
        selectorAll: 'li',
        attr: {
          direct: { selector: '> a', attr: 'text' },
          either: { selector: '> b, span a', attr: 'text' },
          outside: { selector: 'body .t', attr: 'text' },
          self: { attr: 'text' }
        }
      }
    }),
    {
      items: [
        { direct: 'One', either: 'Deep', outside: null, self: null },
        { direct: 'One', either: 'Deep', outside: null, self: null }
      ]
    }
  )
})

test('a rule without a selector reads the whole page as rendered text or as html', async t => {
  const page = await open(t, '<p>Shown</p><script>window.hidden = "script text"</script>')
  const { text, html } = await applyRules(page, { text: { attr: 'text' }, html: {} })
  t.is(text, 'Shown')
  t.true(html.startsWith('<html>'))
})

test('page outline always shows siblings that have no class or have an id', async t => {
  const page = await open(
    t,
    '<div>a</div><div>b</div><div>c</div><div id="main">d</div><div>e</div><table><tr><td>1</td><td>2</td><td>3</td><td>4</td></tr></table>'
  )
  const { outline } = await page.evaluate(pageOutline, OUTLINE_LIMITS)
  t.true(outline.includes('<div id="main"> d'))
  t.true(outline.includes('<div> e'))
  t.true(outline.includes('<td> 4'))
  t.false(outline.includes('more <'))
})

test('page outline keeps a repeated item whose inner structure differs', async t => {
  const plain = '<li class="item"><b class="price">1</b></li>'
  const onSale = '<li class="item"><b class="price">1</b><i class="sale-price">0</i></li>'
  const page = await open(t, `<ul>${plain.repeat(5)}${onSale}</ul>`)
  const { outline } = await page.evaluate(pageOutline, OUTLINE_LIMITS)
  t.true(outline.includes('class="sale-price"'))
  t.true(outline.includes('<!-- 2 more <li> like the ones above -->'))
})

test('page outline shows the value and placeholder of inputs', async t => {
  const page = await open(t, '<input name="q" value="bmw x3" placeholder="Search">')
  const { outline } = await page.evaluate(pageOutline, OUTLINE_LIMITS)
  t.true(outline.includes('name="q"'))
  t.true(outline.includes('value="bmw x3"'))
  t.true(outline.includes('placeholder="Search"'))
})
