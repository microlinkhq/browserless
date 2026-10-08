/* global HTMLElement, getComputedStyle, location, scrollX, scrollY, innerWidth, innerHeight */
// Adapted from browser-use/jev-ultrafast snapshot.js (MIT). See README.md.
module.exports = function snapshot () {
  return (() => {
    if (!document.body) return null
    const cache = (window.__browserlessAgent ||= { ids: new WeakMap(), nodes: new Map(), next: 1 })
    const identity = e => {
      if (!cache.ids.has(e)) cache.ids.set(e, cache.next++)
      const id = cache.ids.get(e)
      cache.nodes.set(id, e)
      return id
    }
    for (const [id, e] of cache.nodes) if (!e.isConnected) cache.nodes.delete(id)
    const roots = [document]
    for (const root of roots) {
      for (const e of root.querySelectorAll('*')) if (e.shadowRoot) roots.push(e.shadowRoot)
    }
    const queryAll = selector => roots.flatMap(root => [...root.querySelectorAll(selector)])
    const flatParent = e => e.assignedSlot || e.parentElement || e.getRootNode().host || null
    const flatChildren = e => {
      if (e.tagName === 'SLOT') {
        const assigned = e.assignedNodes({ flatten: true })
        return assigned.length ? assigned : [...e.childNodes]
      }
      return [...(e.shadowRoot || e).childNodes].filter(
        child => !['STYLE', 'SCRIPT', 'TEMPLATE'].includes(child.tagName)
      )
    }
    cache.closest = (e, selector) => {
      for (let current = e; current; current = flatParent(current)) {
        if (current.matches(selector)) return current
      }
      return null
    }
    cache.contains = (ancestor, e) => {
      for (let current = e; current; current = flatParent(current)) {
        if (current === ancestor) return true
      }
      return false
    }
    cache.elementFromPoint = (x, y) => {
      let hit = document.elementFromPoint(x, y)
      while (hit?.shadowRoot) {
        const { shadowRoot } = hit
        const inner = shadowRoot.elementsFromPoint(x, y).find(e => e.getRootNode() === shadowRoot)
        if (!inner) break
        hit = inner
      }
      return hit
    }
    cache.centerHits = (element, extra) => {
      const rect = element.getBoundingClientRect()
      const x = rect.x + rect.width / 2
      const y = rect.y + rect.height / 2
      if (!rect.width || !rect.height || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
        return false
      }
      const hit = cache.elementFromPoint(x, y)
      return !!hit && (cache.contains(element, hit) || (!!extra && cache.contains(extra, hit)))
    }
    // A wrapping inline link's box center can fall in the gap between line fragments.
    cache.hitPoint = element => {
      const boxes = [...element.getClientRects(), element.getBoundingClientRect()]
      for (const rect of boxes) {
        if (rect.width <= 0 || rect.height <= 0) continue
        const x = rect.x + rect.width / 2
        const y = rect.y + rect.height / 2
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue
        const hit = cache.elementFromPoint(x, y)
        if (!hit || cache.contains(element, hit)) return { x, y }
      }
      return null
    }
    cache.activeElement = () => {
      let active = document.activeElement
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
      return active
    }
    const safe = e => !['password', 'file', 'hidden'].includes(e.type)
    const hiddenMemo = new WeakMap()
    const visibleMemo = new WeakMap()
    const hiddenAncestor = element => {
      const seen = []
      for (let current = element; current; current = flatParent(current)) {
        if (hiddenMemo.has(current)) {
          const found = hiddenMemo.get(current)
          for (const item of seen) hiddenMemo.set(item, found)
          return found
        }
        seen.push(current)
        if (current.matches('[aria-hidden="true"],[inert]')) {
          for (const item of seen) hiddenMemo.set(item, current)
          return current
        }
      }
      for (const item of seen) hiddenMemo.set(item, null)
      return null
    }
    const visible = e => {
      if (visibleMemo.has(e)) return visibleMemo.get(e)
      const shown =
        !hiddenAncestor(e) && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      visibleMemo.set(e, shown)
      return shown
    }
    // cache.guard runs again at input time, so it must not reuse this snapshot's memos.
    const visibleNow = e => {
      for (let current = e; current; current = flatParent(current)) {
        if (current.matches('[aria-hidden="true"],[inert]')) return false
      }
      return e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    }
    const painted = element =>
      !!element?.isConnected &&
      !cache.closest(element, '[inert]') &&
      element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    cache.toggleLabel = input => {
      if (!['checkbox', 'radio'].includes(input?.type)) return null
      return (
        [...(input.labels || [])].find(label => painted(label) && cache.centerHits(label, input)) ||
        null
      )
    }
    const name = (e, seen = new Set()) => {
      if (!e || seen.has(e)) return ''
      seen.add(e)
      return named(e, seen, false)
    }
    const named = (e, seen, skipLabelledBy) => {
      const referenced = skipLabelledBy
        ? ''
        : (e.getAttribute('aria-labelledby') || '')
            .split(/\s+/)
            .map(id => {
              const target = e.getRootNode().getElementById(id)
              return target === e ? named(e, seen, true) : name(target, seen)
            })
            .filter(Boolean)
            .join(' ')
      return (
        referenced ||
        e.getAttribute('aria-label') ||
        [...(e.labels || [])]
          .map(l => name(l, seen))
          .filter(Boolean)
          .join(' ') ||
        (e.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(e.type) ? e.value : '') ||
        e.getAttribute('alt') ||
        (e.tagName === 'INPUT' || e.tagName === 'SELECT'
          ? ''
          : flatChildren(e)
            .map(n =>
              n.nodeType === 3
                ? n.textContent
                : n.nodeType === 1 && n.getAttribute('aria-hidden') !== 'true'
                  ? name(n, seen)
                  : ''
            )
            .join(' ')
            .trim()) ||
        e.getAttribute('title') ||
        e.getAttribute('placeholder') ||
        ''
      )
    }
    const roles = [
      'button',
      'link',
      'checkbox',
      'radio',
      'switch',
      'tab',
      'menuitem',
      'menuitemradio',
      'option',
      'gridcell',
      'combobox',
      'textbox',
      'searchbox',
      'spinbutton'
    ]
    const selector =
      'a[href],button,input,textarea,select,summary,[contenteditable]:not([contenteditable="false"]),' +
      roles.map(role => '[role="' + role + '"]').join(',')
    const editingHost = e => e.isContentEditable && !e.parentElement?.isContentEditable
    const typeable = e => ['INPUT', 'TEXTAREA'].includes(e.tagName) || editingHost(e)
    const role = e => {
      const explicit = e.getAttribute('role')
      if (roles.includes(explicit)) return explicit
      if (e.tagName === 'BUTTON' || e.tagName === 'SUMMARY') return 'button'
      if (e.tagName === 'A') return 'link'
      if (e.tagName === 'SELECT') return 'combobox'
      if (e.tagName === 'TEXTAREA' || editingHost(e)) return 'textbox'
      if (e.tagName === 'INPUT') {
        if (['checkbox', 'radio'].includes(e.type)) return e.type
        if (['button', 'submit', 'reset', 'image'].includes(e.type)) return 'button'
        if (e.type === 'search') return 'searchbox'
        if (e.type === 'number') return 'spinbutton'
        if (['text', 'email', 'url', 'tel'].includes(e.type)) return 'textbox'
      }
      return null
    }
    cache.pageKey = () => [
      performance.timeOrigin,
      location.href,
      scrollX,
      scrollY,
      innerWidth,
      innerHeight,
      queryAll('input,textarea,select')
        .filter(safe)
        .map(e => [identity(e), e.value, e.checked, e.selectedIndex, e.disabled, e.readOnly])
    ]
    // A named form control shadows the form's own innerText property.
    const readInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText').get
    cache.guard = e => {
      if (!e?.isConnected || (!visibleNow(e) && !cache.toggleLabel(e))) return null
      const scope =
        cache.closest(e, 'form,dialog,[role="dialog"],article,li,tr,[role="row"]') || flatParent(e)
      return [
        identity(e),
        role(e),
        name(e),
        e.value ?? null,
        e.checked ?? null,
        e.indeterminate === true,
        e.selectedIndex ?? null,
        e.readOnly ?? null,
        e.matches(':disabled'),
        e.getAttribute('aria-disabled'),
        e.getAttribute('aria-expanded'),
        e.getAttribute('aria-checked'),
        e.getAttribute('aria-selected'),
        e.getAttribute('aria-pressed'),
        e.tagName === 'SELECT'
          ? [...e.options].map(o => [
              o.value,
              o.label,
              o.disabled,
              !!o.closest('optgroup[disabled]')
            ])
          : null,
        e.getAttribute('href'),
        (scope instanceof HTMLElement
          ? readInnerText.call(scope).slice(0, 6000)
          : scope?.textContent?.slice(0, 6000)) || '',
        [...(cache.closest(e, 'form')?.querySelectorAll('input,textarea,select') || [])]
          .filter(safe)
          .map(field => [
            identity(field),
            field.value,
            field.checked,
            field.selectedIndex,
            field.disabled,
            field.readOnly
          ])
      ]
    }
    const actions = []
    for (const e of queryAll(selector)) {
      if (
        !safe(e) ||
        !visible(e) ||
        e.matches(':disabled') ||
        cache.closest(e, '[aria-disabled="true"]')
      ) {
        continue
      }
      const r = e.getBoundingClientRect()
      const rname = role(e)
      if (!rname || (rname === 'gridcell' && e.querySelector('button,[role="button"]'))) continue
      if (!cache.hitPoint(e)) continue
      const base = {
        node: identity(e),
        role: rname,
        label: name(e) || rname,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height }
      }
      for (const key of ['checked', 'selected', 'expanded', 'pressed']) {
        const value = e.getAttribute('aria-' + key)
        if (value !== null) base[key] = value
      }
      if (['checkbox', 'radio'].includes(e.type)) {
        base.checked = e.type === 'checkbox' && e.indeterminate ? 'mixed' : String(e.checked)
      }
      if (e.tagName === 'SELECT') {
        for (const o of e.options) {
          if (!o.selected && !o.disabled && !o.closest('optgroup[disabled]')) {
            actions.push({
              ...base,
              kind: 'select',
              value: o.value,
              current_value: [...e.selectedOptions].map(o => o.label).join(', '),
              label: base.label + ' → ' + o.label
            })
          }
        }
      } else {
        const editable =
          typeable(e) &&
          !e.readOnly &&
          e.getAttribute('aria-readonly') !== 'true' &&
          (['textbox', 'searchbox', 'spinbutton'].includes(rname) ||
            (rname === 'combobox' && ['INPUT', 'TEXTAREA'].includes(e.tagName)))
        const value =
          'value' in e
            ? String(e.value)
            : e.isContentEditable || rname === 'combobox'
              ? e.innerText.trim()
              : ''
        actions.push({ ...base, kind: editable ? 'fill' : 'click', value })
        if (editable) actions.push({ ...base, kind: 'click', value, label: 'Open ' + base.label })
        if (editable && e.tagName === 'INPUT' && value) {
          actions.push({ ...base, kind: 'submit', value, label: 'Submit ' + base.label })
        }
      }
    }
    const collected = new Set(actions.map(action => cache.nodes.get(action.node)))
    for (const input of queryAll('input[type="checkbox"],input[type="radio"]')) {
      if (collected.has(input) || !safe(input) || input.matches(':disabled')) continue
      if (cache.closest(input, '[aria-disabled="true"]')) continue
      const label = cache.toggleLabel(input)
      if (!label) continue
      const rect = label.getBoundingClientRect()
      actions.push({
        node: identity(input),
        role: role(input),
        label: name(input) || name(label) || role(input),
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        kind: 'click',
        checked: input.type === 'checkbox' && input.indeterminate ? 'mixed' : String(input.checked),
        value: String(input.value)
      })
    }
    const listSelector = 'ul,ol,[role="list"],[role="listbox"],[role="menu"],[role="tablist"]'
    const pointer = element => {
      if (getComputedStyle(element).cursor !== 'pointer') return false
      const parent = flatParent(element)
      if (!parent || getComputedStyle(parent).cursor !== 'pointer') return true
      return parent.matches(listSelector)
    }
    const inLayer = element => {
      for (let current = element; current; current = flatParent(current)) {
        if (current === document.body || current === document.documentElement) return false
        const position = getComputedStyle(current).position
        if (position === 'absolute' || position === 'fixed' || position === 'sticky') return true
      }
      return false
    }
    const pointerLists = new WeakMap()
    const inPointerList = element => {
      const parent = flatParent(element)
      if (!parent?.matches(listSelector)) return false
      let eligible = pointerLists.get(parent)
      if (eligible == null) {
        eligible = [...parent.children].filter(pointer).length >= 2
        pointerLists.set(parent, eligible)
      }
      return eligible
    }
    const candidates = []
    for (const element of queryAll('li,div,span,td,dd,p')) {
      if (collected.has(element) || !visible(element) || !pointer(element)) continue
      if (element.matches(':disabled') || cache.closest(element, '[aria-disabled="true"]')) continue
      if (element.querySelector(selector)) continue
      const rect = element.getBoundingClientRect()
      const x = rect.x + rect.width / 2
      const y = rect.y + rect.height / 2
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        x < 0 ||
        y < 0 ||
        x >= innerWidth ||
        y >= innerHeight
      ) {
        continue
      }
      const hit = cache.elementFromPoint(x, y)
      if (hit && !cache.contains(element, hit)) continue
      if (!inLayer(element) && !inPointerList(element)) continue
      const label = (name(element) || '').replace(/\s+/g, ' ').trim().slice(0, 120)
      if (!label) continue
      candidates.push({ element, rect, label })
    }
    const rows = candidates.filter(
      ({ element }) =>
        !candidates.some(
          other => other.element !== element && cache.contains(element, other.element)
        )
    )
    for (const { element, rect, label } of rows.slice(0, 40)) {
      actions.push({
        node: identity(element),
        role: 'button',
        label,
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        kind: 'click',
        value: ''
      })
    }
    const words = []
    const range = document.createRange()
    let length = 0
    const TEXT_SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'])
    const intersectsViewport = rect =>
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.top < innerHeight &&
      rect.right > 0 &&
      rect.left < innerWidth
    const outsideViewport = rect =>
      rect.width > 0 &&
      rect.height > 0 &&
      (rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth)
    const fullyInside = rect =>
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= innerHeight &&
      rect.right <= innerWidth &&
      rect.width > 0 &&
      rect.height > 0
    const pushText = (node, skipRect) => {
      if (length >= 6000 || node.nodeType !== 3) return
      const value = node.textContent.trim()
      if (!value) return
      if (!skipRect) {
        range.selectNodeContents(node)
        if (!intersectsViewport(range.getBoundingClientRect())) return
      }
      words.push(value)
      length += value.length
    }
    // Off-screen subtrees are skipped. A fixed node inside one of those subtrees is not read.
    const collectText = element => {
      if (length >= 6000 || TEXT_SKIP.has(element.tagName)) return
      const rect = element.getBoundingClientRect()
      if (outsideViewport(rect)) return
      const inside = fullyInside(rect)
      if (!intersectsViewport(rect) || !visible(element)) {
        for (const node of element.childNodes) {
          if (node.nodeType === 1) collectText(node)
        }
        return
      }
      for (const node of element.childNodes) {
        if (length >= 6000) return
        if (node.nodeType === 3) pushText(node, inside)
        else if (node.nodeType === 1) collectText(node)
      }
    }
    for (const root of roots) {
      if (length >= 6000) break
      if (root === document) {
        if (document.body) collectText(document.body)
        continue
      }
      const host = root.host
      if (host && visible(host)) {
        for (const node of root.childNodes) pushText(node)
      }
      for (const child of root.children) collectText(child)
    }
    const unsupported = []
    for (const e of queryAll('iframe,canvas,input[type="password"],input[type="file"]')) {
      if (visible(e)) unsupported.push(e.tagName === 'INPUT' ? e.type : e.tagName.toLowerCase())
    }
    const text = words.join('\n').slice(0, 6000)
    const height = document.documentElement.scrollHeight
    const pageKey = cache.pageKey()
    const guards = {}
    const scopes = {}
    for (const a of actions) {
      if (a.node in guards) continue
      const element = cache.nodes.get(a.node)
      guards[a.node] = cache.guard(element)
      const scope =
        cache.closest(element, 'form,dialog,[role="dialog"],article,li,tr,[role="row"]') ||
        flatParent(element)
      scopes[a.node] =
        (scope instanceof HTMLElement
          ? readInnerText.call(scope).slice(0, 1000)
          : scope?.textContent?.slice(0, 1000)) || ''
    }
    // Compare meaning and identity. Geometry is always resolved and hit-tested just before input.
    const semantics = actions.map(({ rect, ...action }) => action)
    const marker = [
      performance.timeOrigin,
      location.href,
      scrollX,
      scrollY,
      innerWidth,
      innerHeight,
      document.title,
      text,
      semantics,
      pageKey[6]
    ]
    const omittedActions = Math.max(0, actions.length - 250)
    actions.splice(250)
    actions.forEach((a, i) => {
      a.id = 'e' + (i + 1)
    })
    if (scrollY + innerHeight < height - 2) {
      actions.push({ id: 'scroll_down', kind: 'scroll', label: 'Scroll down', delta: 560 })
    }
    if (scrollY > 0) {
      actions.push({ id: 'scroll_up', kind: 'scroll', label: 'Scroll up', delta: -560 })
    }
    actions.push({ id: 'wait', kind: 'wait', label: 'Wait for the page to update' })
    return {
      url: location.href,
      title: document.title,
      w: innerWidth,
      h: innerHeight,
      text,
      unsupported,
      scroll: { y: scrollY, height },
      actions,
      marker,
      pageKey,
      guards,
      scopes,
      omittedActions
    }
  })()
}
