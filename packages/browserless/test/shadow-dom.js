'use strict'

const test = require('ava')

const { runServer, getBrowserContext } = require('@browserless/test')

const getUrl = t =>
  runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(`<!DOCTYPE html>
<html>
<head>
  <script>
    class MyRow extends HTMLElement {
      connectedCallback() {
        const shadow = this.attachShadow({ mode: 'open' })
        const name = this.getAttribute('name') || ''
        const value = this.getAttribute('value') || ''
        shadow.innerHTML = '<div class="row"><span>' + name + '</span><span>' + value + '</span></div>'
      }
    }
    customElements.define('my-row', MyRow)
  </script>
</head>
<body>
  <h1>Shadow DOM Table</h1>
  <div id="table">
    <my-row name="Alice" value="100"></my-row>
    <my-row name="Bob" value="200"></my-row>
    <my-row name="Charlie" value="300"></my-row>
  </div>
</body>
</html>`)
  })

const getNestedUrl = t =>
  runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(`<!DOCTYPE html>
<html>
<head>
  <script>
    class InnerItem extends HTMLElement {
      connectedCallback() {
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.innerHTML = '<span class="label">' + this.getAttribute('label') + '</span>'
      }
    }
    class OuterList extends HTMLElement {
      connectedCallback() {
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.innerHTML = '<div class="list">' +
          '<inner-item label="nested-a"></inner-item>' +
          '<inner-item label="nested-b"></inner-item>' +
        '</div>'
      }
    }
    customElements.define('inner-item', InnerItem)
    customElements.define('outer-list', OuterList)
  </script>
</head>
<body>
  <outer-list></outer-list>
</body>
</html>`)
  })

test('shadow DOM content is flattened into page.content()', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const html = await browserless.html(url, { flattenShadowDOM: true })
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '')

  t.true(withoutScripts.includes('<span>Alice</span>'))
  t.true(withoutScripts.includes('<span>Bob</span>'))
  t.true(withoutScripts.includes('<span>Charlie</span>'))
  t.true(withoutScripts.includes('<span>100</span>'))
  t.true(withoutScripts.includes('<span>200</span>'))
  t.true(withoutScripts.includes('<span>300</span>'))
})

test('nested shadow DOMs are flattened recursively', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getNestedUrl(t)

  const html = await browserless.html(url, { flattenShadowDOM: true })
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '')

  t.true(withoutScripts.includes('nested-a'))
  t.true(withoutScripts.includes('nested-b'))
  t.true(withoutScripts.includes('<span class="label">'))
})

test('shadow DOM is flattened by default for html serialization', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const html = await browserless.html(url)
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '')

  t.true(withoutScripts.includes('<div class="row">'))
  t.true(withoutScripts.includes('<span>Alice</span>'))
})

test('shadow DOM flattening is off by default for goto', async t => {
  const browserless = await getBrowserContext(t)
  const page = await browserless.page()
  const url = await getUrl(t)

  await browserless.goto(page, { url })
  const html = await page.content()
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '')

  t.false(withoutScripts.includes('<div class="row">'))
})

test('shadow DOM flattening can be disabled', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const html = await browserless.html(url, { flattenShadowDOM: false })
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '')

  t.false(withoutScripts.includes('<div class="row">'))
})

const getSlottedUrl = t =>
  runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(`<!DOCTYPE html>
<html>
<head>
  <script>
    class MyCard extends HTMLElement {
      connectedCallback() {
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.innerHTML = '<div class="card"><h2><slot name="title"></slot></h2><div class="body"><slot></slot></div></div>'
      }
    }
    customElements.define('my-card', MyCard)
  </script>
</head>
<body>
  <my-card>
    <span slot="title">Card Title</span>
    <p>Card body content here</p>
  </my-card>
</body>
</html>`)
  })

const getSlottedShadowHostUrl = t =>
  runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(`<!DOCTYPE html>
<html>
<head>
  <script>
    class MyCard extends HTMLElement {
      connectedCallback() {
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.innerHTML = '<section><slot></slot></section>'
      }
    }
    class InnerBadge extends HTMLElement {
      connectedCallback() {
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.innerHTML = '<strong>Nested shadow badge</strong>'
      }
    }
    customElements.define('my-card', MyCard)
    customElements.define('inner-badge', InnerBadge)
  </script>
</head>
<body>
  <my-card>
    <inner-badge></inner-badge>
  </my-card>
</body>
</html>`)
  })

test('slotted light-DOM content is preserved after flattening', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getSlottedUrl(t)

  const html = await browserless.html(url, { flattenShadowDOM: true })
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '')

  t.true(withoutScripts.includes('<div class="card">'))
  t.true(withoutScripts.includes('<h2><span slot="title">Card Title</span></h2>'))
  t.false(withoutScripts.includes('<slot'))
  t.true(withoutScripts.includes('Card Title'))
  t.true(withoutScripts.includes('Card body content here'))
})

test('slotted shadow hosts are flattened before cloning', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getSlottedShadowHostUrl(t)

  const html = await browserless.html(url, { flattenShadowDOM: true })
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '')

  t.true(withoutScripts.includes('<section>'))
  t.true(withoutScripts.includes('<inner-badge><strong>Nested shadow badge</strong></inner-badge>'))
  t.false(withoutScripts.includes('<slot'))
})

const getEmptySlotUrl = t =>
  runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(`<!DOCTYPE html>
<html>
<head>
  <script>
    class MyPanel extends HTMLElement {
      connectedCallback() {
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.innerHTML = '<div class="panel"><slot name="header"></slot><div class="body"><slot></slot></div><slot name="footer"></slot></div>'
      }
    }
    customElements.define('my-panel', MyPanel)
  </script>
</head>
<body>
  <my-panel>
    <p>Main content</p>
  </my-panel>
</body>
</html>`)
  })

const getFallbackSlotUrl = t =>
  runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(`<!DOCTYPE html>
<html>
<head>
  <script>
    class MyWidget extends HTMLElement {
      connectedCallback() {
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.innerHTML = '<div class="widget"><slot name="label"><span class="default-label">Default</span></slot></div>'
      }
    }
    customElements.define('my-widget', MyWidget)
  </script>
</head>
<body>
  <my-widget></my-widget>
</body>
</html>`)
  })

test('empty slots with no assigned nodes are removed', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getEmptySlotUrl(t)

  const html = await browserless.html(url, { flattenShadowDOM: true })
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '')

  t.false(withoutScripts.includes('<slot'))
  t.true(withoutScripts.includes('Main content'))
  t.true(withoutScripts.includes('<div class="panel">'))
})

test('slots with fallback content use the fallback when no nodes are assigned', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getFallbackSlotUrl(t)

  const html = await browserless.html(url, { flattenShadowDOM: true })
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '')

  t.false(withoutScripts.includes('<slot'))
  t.true(withoutScripts.includes('<span class="default-label">Default</span>'))
})

test('custom element attributes are preserved after flattening', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const html = await browserless.html(url, { flattenShadowDOM: true })

  t.true(html.includes('name="Alice"'))
  t.true(html.includes('value="100"'))
  t.true(html.includes('name="Bob"'))
  t.true(html.includes('value="200"'))
  t.true(html.includes('name="Charlie"'))
  t.true(html.includes('value="300"'))
})
