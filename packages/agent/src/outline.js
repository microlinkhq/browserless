module.exports = function pageOutline (limits) {
  const SKIPPED = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'LINK', 'META', 'HEAD']
  const KEPT_ATTRIBUTES = [
    'id',
    'class',
    'role',
    'href',
    'src',
    'name',
    'type',
    'value',
    'placeholder',
    'itemprop',
    'aria-label',
    'datetime',
    'alt',
    'title'
  ]
  const lines = []
  let length = 0

  const rendered = element =>
    element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ||
    window.getComputedStyle(element).display === 'contents'

  const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text)

  const attributes = element =>
    [...element.attributes]
      .filter(({ name }) => KEPT_ATTRIBUTES.includes(name) || name.startsWith('data-'))
      .map(({ name, value }) => `${name}="${clip(value, limits.attribute)}"`)
      .join(' ')

  const shape = element => `${element.tagName}.${[...element.classList].sort().join('.')}`

  const isRepeatable = element => element.classList.length > 0 && !element.id

  const signature = element => `${shape(element)}|${[...element.children].map(shape).join(',')}`

  const push = (depth, line) => {
    const indented = `${'  '.repeat(depth)}${line}`
    lines.push(indented)
    length += indented.length + 1
  }

  const walk = (element, depth) => {
    if (length >= limits.characters) return
    const shown = attributes(element)
    const tag = element.tagName.toLowerCase()
    const ownText = [...element.childNodes]
      .filter(node => node.nodeType === 3)
      .map(node => node.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ')
    push(
      depth,
      `<${tag}${shown ? ` ${shown}` : ''}>${ownText ? ` ${clip(ownText, limits.text)}` : ''}`
    )
    const seen = new Map()
    for (const child of element.children) {
      if (
        SKIPPED.includes(child.tagName.toUpperCase()) ||
        child.getAttribute('aria-hidden') === 'true'
      ) { continue }
      if (!rendered(child)) continue
      if (!isRepeatable(child)) {
        walk(child, depth + 1)
        continue
      }
      const key = signature(child)
      const count = (seen.get(key) || 0) + 1
      seen.set(key, count)
      if (count <= limits.siblings) walk(child, depth + 1)
    }
    for (const [key, count] of seen) {
      if (count > limits.siblings) {
        push(
          depth + 1,
          `<!-- ${count - limits.siblings} more <${key
            .split('.')[0]
            .toLowerCase()}> like the ones above -->`
        )
      }
    }
  }

  if (document.body) walk(document.body, 0)
  return {
    url: document.location.href,
    title: document.title,
    outline: lines.join('\n').slice(0, limits.characters)
  }
}
