module.exports = (payload, { prism, theme }) => `
<html>
  <head>
    ${theme}
    <style>
      body {
        margin: 0;
      }
      pre[class*="language-"] {
        margin-top: -15px;
        position: absolute;
        right: 0;
        left: 0;
        top: 0;
        bottom: 0;
        margin: 0;
        border-radius: 0;
        padding-left: 16px;
        padding-right: 16px;
      }
      code[class*="language-"], pre[class*="language-"] {
        padding-top: 0;
        padding-bottom: 0;
        border: 0;
      }
      span {
        line-height: 1.5;
        font-size: 16px;
        font-weight: normal;
        font-family: "Operator Mono", "Fira Code", "SF Mono", "Roboto Mono", Menlo, monospace;
      }
    </style>
  </head>
  <body>
    <pre>
      <code class="language-js">
${JSON.stringify(payload, null, 2)}</code>
    </pre>
  </body>
  <script>${prism}</script>
</html>
`
