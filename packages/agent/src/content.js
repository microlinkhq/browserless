/* global location, getComputedStyle */
module.exports = function pageContent (limit) {
  const SKIPPED = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG']
  const LINE_BREAKING =
    /^(A|ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|BR|DD|DIV|DL|DT|FIELDSET|FIGURE|FOOTER|FORM|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TD|TH|TR|UL)$/
  const parts = []
  let length = 0
  const push = part => {
    parts.push(part)
    length += part.length
  }
  const flatChildren = e => {
    if (e.tagName === 'SLOT') {
      const assigned = e.assignedNodes({ flatten: true })
      return assigned.length ? assigned : e.childNodes
    }
    return (e.shadowRoot || e).childNodes
  }
  const rendered = e =>
    e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ||
    getComputedStyle(e).display === 'contents'
  const walk = node => {
    if (length >= limit) return
    if (node.nodeType === 3) {
      const text = node.textContent.replace(/\s+/g, ' ').trim()
      if (text) push(text + ' ')
      return
    }
    if (node.nodeType !== 1 || SKIPPED.includes(node.tagName.toUpperCase())) return
    if (node.getAttribute('aria-hidden') === 'true' || !rendered(node)) return
    for (const child of flatChildren(node)) walk(child)
    if (node.tagName === 'A' && node.href) push(`<${node.href}> `)
    if (LINE_BREAKING.test(node.tagName)) push('\n')
  }
  if (document.body) walk(document.body)
  const text = parts
    .join('')
    .replace(/ *\n[ \n]*/g, '\n')
    .trim()
    .slice(0, limit)
  return { url: location.href, title: document.title, text }
}
