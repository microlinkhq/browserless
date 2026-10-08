'use strict'

const test = require('ava')
const { JSDOM } = require('jsdom')
const snapshot = require('../src/snapshot')
const { targetFresh } = require('../src/browser')

const dom = html => {
  const { window } = new JSDOM(html, { url: 'https://fixture.invalid', runScripts: 'outside-only' })
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get () {
      return this.textContent
    }
  })
  window.HTMLElement.prototype.checkVisibility = function () {
    return !this.hidden
  }
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { x: 10, y: 10, width: 100, height: 30, bottom: 40, top: 10, right: 110, left: 10 }
  }
  window.Range.prototype.getBoundingClientRect = () => ({
    width: 100,
    height: 30,
    bottom: 40,
    top: 10,
    right: 110,
    left: 10
  })
  window.document.elementFromPoint = () => null
  const observe = () => window.eval(`(${snapshot.toString()})()`)
  const fresh = (element, state, action, requirements = {}) => {
    window.target = element
    window.observed = state
    window.action = action
    window.requirements = requirements
    window.document.elementFromPoint = () => element
    return window.eval(
      `(${targetFresh.toString()})(window.target, window.observed, window.action, window.requirements)`
    )
  }
  return { window, observe, fresh }
}

test('a control hidden after observe is no longer fresh', t => {
  const { window, observe, fresh } = dom('<body><button id="a">Open</button></body>')
  const current = observe()
  const element = window.document.getElementById('a')
  const action = current.actions[0]
  t.true(fresh(element, current, action))
  element.setAttribute('aria-hidden', 'true')
  t.false(fresh(element, current, action))
})

test('snapshot text follows document order and skips aria-hidden copy', t => {
  const { observe } = dom(
    '<body><p>before <a href="/a">link</a> after</p><p aria-hidden="true">Hidden copy</p></body>'
  )
  t.is(observe().text, 'before\nlink\nafter')
})

test('snapshot uses visible indexed controls, viewport text, and persistent live refs', t => {
  const { window, observe } = dom(
    '<body><button id="a">Search</button><button hidden>Hidden</button><button disabled>Disabled</button><div aria-hidden="true"><button>Aria hidden</button></div><p>Cars</p></body>'
  )
  const first = observe()
  t.deepEqual(
    first.actions.filter(a => a.kind === 'click').map(a => a.label),
    ['Search']
  )
  t.true(first.text.includes('Cars'))
  const node = first.actions[0].node
  t.is(window.__browserlessAgent.nodes.get(node), window.document.getElementById('a'))
  window.document.body.prepend(window.document.createElement('button'))
  const second = observe()
  const same = second.actions.find(a => a.label === 'Search')
  t.is(same.node, node)
  t.not(same.id, first.actions[0].id)
})

test('snapshot skips password/file inputs and reports unsupported surfaces', t => {
  const { observe } = dom(
    '<body><input type="password"><input type="file"><iframe></iframe><canvas></canvas><input type="search" aria-label="Search"></body>'
  )
  const current = observe()
  t.deepEqual(Array.from(current.unsupported).sort(), ['canvas', 'file', 'iframe', 'password'])
  t.true(current.actions.every(a => !['password', 'file'].includes(a.role)))
  t.is(current.actions.filter(a => a.kind === 'fill').length, 1)
})

test('target guard tolerates unrelated DOM changes but rejects same-form value changes', t => {
  const { window, observe, fresh } = dom(
    '<body><form><input id="query" aria-label="Query"><input id="price" aria-label="Price"><button id="submit">Search</button></form><aside id="other">Old</aside><form><input id="outside"></form></body>'
  )
  const current = observe()
  const element = window.document.getElementById('submit')
  const action = current.actions.find(a => a.label === 'Search')
  window.document.getElementById('other').textContent = 'Unrelated update'
  window.document.getElementById('outside').value = 'unrelated form update'
  t.true(fresh(element, current, action))
  window.document.getElementById('price').value = 'different price'
  t.false(fresh(element, current, action))
})

test('identity, nearby text, disabled state and covered targets are guarded', t => {
  const { window, observe, fresh } = dom(
    '<body><article><p id="context">BMW X3</p><button id="target">Open</button></article></body>'
  )
  const current = observe()
  const element = window.document.getElementById('target')
  const action = current.actions[0]
  t.true(fresh(element, current, action))
  window.document.getElementById('context').textContent = 'Different car'
  t.false(fresh(element, current, action))
  window.document.getElementById('context').textContent = 'BMW X3'
  element.disabled = true
  t.false(fresh(element, current, action))
  element.disabled = false
  const replacement = element.cloneNode(true)
  element.replaceWith(replacement)
  t.false(fresh(replacement, current, action))
  observe()
  t.false(window.__browserlessAgent.nodes.has(action.node))
})

test('moving target is allowed if still visible and hit-tested; covering it is stale', t => {
  const { window, observe, fresh } = dom('<body><button>Open</button></body>')
  const current = observe()
  const element = window.document.querySelector('button')
  const action = current.actions[0]
  element.getBoundingClientRect = () => ({ x: 200, y: 100, width: 100, height: 30 })
  t.true(fresh(element, current, action))
  window.target = element
  window.observed = current
  window.action = action
  window.document.elementFromPoint = () => window.document.body
  t.false(window.eval(`(${targetFresh.toString()})(window.target,window.observed,window.action)`))
})

test('snapshot caps controls at 250 and reports truncation', t => {
  const { observe } = dom(`<body>${'<button>Open</button>'.repeat(260)}</body>`)
  const current = observe()
  t.is(current.actions.filter(a => a.kind === 'click').length, 250)
  t.is(current.omittedActions, 10)
})

test('select option mutation invalidates a previously observed value', t => {
  const { window, observe, fresh } = dom(
    '<body><select><option value="a">A</option><option value="b">B</option></select></body>'
  )
  const element = window.document.querySelector('select')
  const current = observe()
  const action = current.actions.find(a => a.kind === 'select')
  t.true(fresh(element, current, action))
  element.options[1].textContent = 'Different meaning'
  t.false(fresh(element, current, action))
})

test('fill target must hold keyboard focus when focus is required', t => {
  const { window, observe, fresh } = dom(
    '<body><input id="target" aria-label="Search"><input id="other" aria-label="Other"></body>'
  )
  const current = observe()
  const element = window.document.getElementById('target')
  const action = current.actions.find(a => a.kind === 'fill' && a.label === 'Search')
  t.true(fresh(element, current, action))
  t.false(fresh(element, current, action, { focused: true }))
  element.focus()
  t.true(fresh(element, current, action, { focused: true }))
  window.document.getElementById('other').focus()
  t.false(fresh(element, current, action, { focused: true }))
})

test('only typeable editing hosts are indexed as fill targets', t => {
  const { window, observe } = dom(
    '<body><div contenteditable aria-label="Bare"><b contenteditable="bogus" aria-label="Nested">x</b></div><div contenteditable="true" aria-label="Explicit"></div><div contenteditable="plaintext-only" aria-label="Plain"></div><div contenteditable="false" aria-label="Locked"></div><div role="textbox" aria-label="Fake"></div></body>'
  )
  Object.defineProperty(window.HTMLElement.prototype, 'isContentEditable', {
    get () {
      const host = this.closest('[contenteditable]')
      return !!host && host.getAttribute('contenteditable') !== 'false'
    }
  })
  const { actions } = observe()
  t.deepEqual(
    actions.filter(a => a.kind === 'fill').map(a => a.label),
    ['Bare', 'Explicit', 'Plain']
  )
  t.deepEqual(
    actions.filter(a => a.kind === 'click').map(a => a.label),
    ['Open Bare', 'Open Explicit', 'Open Plain', 'Fake']
  )
})

test('an in-flow icon control is named from the icon, not the row', t => {
  const { observe } = dom(
    `<body>
      <h1>Repos</h1>
      <div style="cursor:pointer"><svg id="star"><title>Star</title></svg></div>
      <div style="cursor:pointer"><svg class="w-4 ruyi-icon-bell"></svg></div>
      <div style="cursor:pointer"><svg aria-label="Pin"></svg></div>
      <div hidden style="cursor:pointer"><svg><title>Hidden</title></svg></div>
      <div aria-disabled="true" style="cursor:pointer"><svg><title>Disabled</title></svg></div>
      <div style="cursor:pointer">Not an icon</div>
    </body>`
  )
  const clicks = observe()
    .actions.filter(action => action.kind === 'click')
    .map(action => action.label)
  t.true(clicks.includes('Star'))
  t.true(clicks.includes('bell'))
  t.true(clicks.includes('Pin'))
  t.false(clicks.includes('4'))
  t.false(clicks.includes('Hidden'))
  t.false(clicks.includes('Disabled'))
  t.false(clicks.includes('Not an icon'))
  t.false(clicks.includes('Repos'))
})

test('an icon inside an indexed control is not a second action', t => {
  const { observe } = dom(
    `<body>
      <a href="/home"><span style="cursor:pointer"><svg><title>Star</title></svg></span> Home</a>
      <div style="cursor:pointer"><svg><title>Gear</title></svg></div>
    </body>`
  )
  const clicks = observe()
    .actions.filter(action => action.kind === 'click')
    .map(action => action.label)
  t.false(clicks.includes('Star'))
  t.true(clicks.includes('Gear'))
  t.true(clicks.some(label => label.includes('Home')))
})

test('an icon beside a button in a skipped gridcell is still offered', t => {
  const { observe } = dom(
    `<body>
      <div role="gridcell">
        <button type="button">Edit</button>
        <span style="cursor:pointer"><svg><title>Star</title></svg></span>
      </div>
    </body>`
  )
  const clicks = observe()
    .actions.filter(action => action.kind === 'click')
    .map(action => action.label)
  t.true(clicks.includes('Edit'))
  t.true(clicks.includes('Star'))
})

test('an icon inside a disabled control is not offered', t => {
  const { observe } = dom(
    `<body>
      <button type="button" disabled><span style="cursor:pointer"><svg><title>Star</title></svg></span></button>
      <div style="cursor:pointer"><svg><title>Gear</title></svg></div>
    </body>`
  )
  const clicks = observe()
    .actions.filter(action => action.kind === 'click')
    .map(action => action.label)
  t.false(clicks.includes('Star'))
  t.true(clicks.includes('Gear'))
})

test('an indeterminate checkbox is mixed, and clearing it fails freshness', t => {
  const { window, observe, fresh } = dom('<input id="all" type="checkbox" aria-label="All">')
  const box = window.document.getElementById('all')
  box.indeterminate = true
  const current = observe()
  const action = current.actions.find(item => item.label === 'All')
  t.is(action.checked, 'mixed')
  t.true(fresh(box, current, action))
  box.indeterminate = false
  t.false(fresh(box, current, action))
})

test('aria-pressed is reported, and changing it fails freshness', t => {
  const { window, observe, fresh } = dom(
    '<button id="nonstop" aria-pressed="false">Nonstop only</button>'
  )
  const current = observe()
  const action = current.actions.find(item => item.label === 'Nonstop only')
  const button = window.document.getElementById('nonstop')
  t.is(action.pressed, 'false')
  t.true(fresh(button, current, action))
  button.setAttribute('aria-pressed', 'true')
  t.false(fresh(button, current, action))
  const next = observe()
  t.is(next.actions.find(item => item.label === 'Nonstop only').pressed, 'true')
  t.not(JSON.stringify(current.marker), JSON.stringify(next.marker))
})

test('a self reference in aria-labelledby keeps the element text', t => {
  const { observe } = dom(
    `<body>
      <span id="f1">report.pdf</span>
      <button id="e1" aria-labelledby="e1 f1">Edit</button>
      <button id="d1" aria-labelledby="d1 f1">Delete</button>
    </body>`
  )
  t.deepEqual(
    observe()
      .actions.filter(action => action.kind === 'click')
      .map(action => action.label),
    ['Edit report.pdf', 'Delete report.pdf']
  )
})

test('an unlabeled select is not named by its options', t => {
  const { observe } = dom(
    `<body>
      <select><option>North</option><option>South</option></select>
      <select aria-label="Region"><option>North</option><option>South</option></select>
    </body>`
  )
  t.deepEqual(
    observe()
      .actions.filter(action => action.kind === 'select')
      .map(action => action.label),
    ['combobox → South', 'Region → South']
  )
})

test('a button is named from its text, and an input button from its value', t => {
  const { observe } = dom(
    '<body><button name="published" value="0">Save draft</button><input type="submit" value="Go"></body>'
  )
  t.deepEqual(
    observe()
      .actions.filter(action => action.kind === 'click')
      .map(action => action.label),
    ['Save draft', 'Go']
  )
})

test('an image input is named from its alt text', t => {
  const { observe } = dom('<body><input type="image" alt="Search" value="go"></body>')
  t.is(observe().actions.find(action => action.kind === 'click').label, 'Search')
})

test('pointer rows in a layer or a pointer list are clickable; a lone pointer div is not', t => {
  const { observe } = dom(
    `<body>
      <button>Search</button>
      <input aria-label="City">
      <div style="position:absolute">
        <div style="cursor:pointer"><span>Beijingbei</span><span>beijingbei</span></div>
      </div>
      <div style="cursor:pointer">Not a suggestion</div>
      <ul>
        <li style="cursor:pointer">One</li>
        <li style="cursor:pointer">Two</li>
      </ul>
    </body>`
  )
  const clicks = observe()
    .actions.filter(action => action.kind === 'click')
    .map(action => action.label)
  t.true(clicks.includes('Search'))
  t.true(clicks.some(label => label.includes('Beijingbei') && label.includes('beijingbei')))
  t.true(clicks.includes('One'))
  t.true(clicks.includes('Two'))
  t.false(clicks.includes('Not a suggestion'))
})

test('inherited pointer and a relative body do not split or invent rows', t => {
  const { observe } = dom(
    `<body style="position:relative">
      <div style="cursor:pointer">Plain</div>
      <div style="position:absolute">
        <div style="cursor:pointer"><span style="cursor:pointer">Beijingbei</span><span style="cursor:pointer">beijingbei</span></div>
      </div>
    </body>`
  )
  const clicks = observe()
    .actions.filter(action => action.kind === 'click')
    .map(action => action.label)
  t.false(clicks.includes('Plain'))
  t.false(clicks.includes('Beijingbei'))
  t.true(clicks.some(label => label.includes('Beijingbei') && label.includes('beijingbei')))
})

test('rows stay when the list and its text share a pointer cursor', t => {
  // jsdom does not inherit cursor, so the rule sets the value a browser inherits from the list.
  const { observe } = dom(
    `<body>
      <style>ul, ul li, ul li span { cursor: pointer }</style>
      <ul><li><span>One</span><span>uno</span></li><li>Two</li></ul>
    </body>`
  )
  const clicks = observe()
    .actions.filter(action => action.kind === 'click')
    .map(action => action.label)
  t.true(clicks.some(label => label.includes('One') && label.includes('uno')))
  t.true(clicks.includes('Two'))
  t.false(clicks.includes('One'))
  t.false(clicks.includes('uno'))
})

test('custom pointer rows are capped at 40', t => {
  const items = Array.from(
    { length: 41 },
    (_, index) => `<li style="cursor:pointer">Row ${index}</li>`
  )
  const { observe } = dom(`<body><ul>${items.join('')}</ul></body>`)
  const rows = observe().actions.filter(action => action.label.startsWith('Row '))
  t.is(rows.length, 40)
  t.true(rows.every(action => action.role === 'button' && action.kind === 'click'))
})

test('same-labeled fields keep distinct scope text off the action list', t => {
  const { observe } = dom(
    '<body><article><h2>Passenger 1</h2><input aria-label="First name"></article><article><h2>Passenger 2</h2><input aria-label="First name"></article></body>'
  )
  const { actions, scopes } = observe()
  const fields = actions.filter(a => a.kind === 'fill')
  t.deepEqual(
    fields.map(a => a.label),
    ['First name', 'First name']
  )
  t.false(fields.some(a => 'context' in a))
  t.true(scopes[fields[0].node].includes('Passenger 1'))
  t.true(scopes[fields[1].node].includes('Passenger 2'))
  t.not(scopes[fields[0].node], scopes[fields[1].node])
})

test('submit is offered only for inputs that already hold a value', t => {
  const { observe } = dom(
    '<body><input aria-label="Filled" value="bmw x3"><input aria-label="Empty"><textarea aria-label="Notes">text</textarea></body>'
  )
  t.deepEqual(
    observe()
      .actions.filter(a => a.kind === 'submit')
      .map(a => [a.label, a.value]),
    [['Submit Filled', 'bmw x3']]
  )
})
