const mapValuesDeep = require('map-values-deep')
const truncate = require('cli-truncate')

const textStyle = ({ factor = 1 }) => `
  line-height: 1.6;
  font-size: ${36 * factor}px;
  font-weight: 400;
  font-family: "Operator Mono", "Fira Code", "SF Mono", "Ubuntu Mono", "Roboto Mono", Menlo, monospace;
`

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
    padding: .5rem 1rem;
    border: 0;

    position: absolute;
    right: 0;
    left: 0;
    top: 0;
    bottom: 0;
  }

  .language-js span {
    ${textStyle({ factor: 1 })}
  }

  .language-text span {
    ${textStyle({ factor: 1.25 })}
  }
</style>`

const JSON_MAX_LENGTH = 80
const TRUNCATE_MAX_LENGTH = JSON_MAX_LENGTH * 0.6

const compactJSON = payload => {
  const sanetized = mapValuesDeep(payload, value => {
    if (typeof value !== 'string') return value
    return truncate(value, TRUNCATE_MAX_LENGTH, { position: 'end' }).trim()
  })

  return (
    JSON.stringify(sanetized, null, 2)
      // compact objects '},\n  {' → '}, {'
      .replace(new RegExp('},\\n  {', 'g'), '}, {')
      // compact array object start '[,\n  {' → '[{'
      .replace(new RegExp('\\[\\n  {', 'g'), '[{')
      // compact array object end '},\n  ]' → '}]'
      .replace(new RegExp(' {2}\\}\\n]', 'g'), '}]')
  )
}

const compactText = payload => {
  return payload
    .split('\n')
    .map(str => truncate(str, TRUNCATE_MAX_LENGTH, { position: 'end' }).trim())
    .join('\n')
}

const content = (payload, contentType) =>
  contentType === 'json' ? compactJSON(payload) : compactText(payload)

const language = contentType => (contentType === 'json' ? 'language-js' : 'language-text')

module.exports = (payload, { contentType, prism, theme }) => {
  const css = `${resetCSS}\n${theme}`
  const lang = language(contentType)
  const code = content(payload, contentType)

  return `<html>
  <head>${css}</head>
  <body><pre><code class="${lang}">${code}</code></pre></body>
  <script>${prism}</script>
</html>`
}
