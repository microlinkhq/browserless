/* eslint-disable prefer-regex-literals */

'use strict'

const mapValuesDeep = require('map-values-deep')

const resetCSS = `<style>
  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    border-radius: 0;
  }

  body pre[class*="language-"] {
    margin: 0;
    border-radius: 0;
    padding: 2rem;
    border: 0;

    position: absolute;
    right: 0;
    left: 0;
    top: 0;
    bottom: 0;
  }

  span  {
    line-height: 1.6;
    font-size: 36px;
    font-weight: 400;
    font-family: "Operator Mono", "Fira Code", "SF Mono", "Roboto Mono", "Ubuntu Mono", Menlo, monospace;
  }
</style>`

const JSON_MAX_LENGTH = 71 * 0.5
const TEXT_MAX_LENGTH = 96 * 0.6

const truncate = (input, maxLength) => {
  let text = input.slice(0, maxLength)
  if (text.length < input.length) text = text.trim() + '…'
  return text
}

const compactJSON = payload => {
  const sanetized = mapValuesDeep(payload, value => {
    if (typeof value !== 'string') return value
    return truncate(value, JSON_MAX_LENGTH)
  })

  const SPACE = 4
  const SPACE_IDENTATION = ' '.repeat(SPACE)

  return (
    JSON.stringify(sanetized, null, SPACE)
      // compact objects '},\n  {' → '}, {'
      .replace(new RegExp(`},\\n${SPACE_IDENTATION}{`, 'g'), '}, {')
      // compact array object start '[,\n  {' → '[{'
      .replace(new RegExp(`\\[\\n${SPACE_IDENTATION}{`, 'g'), '[{')
      // compact array object end '},\n  ]' → '}]'
      .replace(new RegExp(' {2}\\}\\n]', 'g'), '}]')
  )
}

const compactText = payload => {
  return payload
    .split('\n')
    .map(str => truncate(str, TEXT_MAX_LENGTH))
    .join('\n')
}

const content = (payload, contentType) =>
  contentType === 'json' ? compactJSON(payload) : compactText(payload)

const language = contentType => (contentType === 'json' ? 'language-js' : 'language-text')

module.exports = (payload, { contentType, prism, theme }) => {
  const css = `${resetCSS}\n${theme}`
  const lang = language(contentType)
  const code = content(payload, contentType)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  ${css}
</head>
<body id="screenshot">
  <pre><code class="${lang}">${code}</code></pre>
  <script>${prism}</script>
</body>
</html>`
}
