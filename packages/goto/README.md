<div align="center">
  <img style="width: 500px; margin:3rem 0 1.5rem;" src="https://github.com/microlinkhq/browserless/raw/master/static/logo-banner.png#gh-light-mode-only" alt="browserless">
  <img style="width: 500px; margin:3rem 0 1.5rem;" src="https://github.com/microlinkhq/browserless/raw/master/static/logo-banner-light.png#gh-dark-mode-only" alt="browserless">
  <br><br>
  <a href="https://microlink.io"><img src="https://img.shields.io/badge/powered_by-microlink.io-blue?style=flat-square&color=%23EA407B" alt="Powered by microlink.io"></a>
  <img src="https://img.shields.io/github/tag/microlinkhq/browserless.svg?style=flat-square" alt="Last version">
  <a href="https://coveralls.io/github/microlinkhq/browserless"><img src="https://img.shields.io/coveralls/microlinkhq/browserless.svg?style=flat-square" alt="Coverage Status"></a>
  <a href="https://www.npmjs.org/package/browserless"><img src="https://img.shields.io/npm/dm/browserless.svg?style=flat-square" alt="NPM Status"></a>
  <br><br>
</div>

> @browserless/goto: Go to a page aborting unnecessary requests.

See the [Go To section](https://browserless.js.org/#/?id=gotopage-options) on our website for more details.

## Install

Using npm:

```sh
npm install @browserless/goto --save
```

## About

This package provides **advanced page navigation** with built-in ad blocking, smart waiting strategies, and extensive customization options. It's the core navigation engine that powers all browserless page loading operations.

### What this package does

The `@browserless/goto` package allows you to:

- **Navigate to pages** with optimized loading and smart waiting strategies
- **Block ads and trackers** using a precompiled Ghostery ad-blocker engine
- **Inject scripts, modules, and styles** into pages
- **Emulate devices** with viewport, user agent, and media features
- **Intercept and abort requests** by resource type
- **Handle cookies and authentication** seamlessly

### Usage

```js
const createGoto = require('@browserless/goto')
const puppeteer = require('puppeteer')

const goto = createGoto({ 
  timeout: 30000,
  defaultDevice: 'Macbook Pro 13'
})

const browser = await puppeteer.launch()
const page = await browser.newPage()

const { response, device, error } = await goto(page, {
  url: 'https://example.com',
  adblock: true,
  waitUntil: 'auto'
})
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | — | Target URL to navigate to |
| `html` | `string` | — | HTML content to render (instead of URL) |
| `adblock` | `boolean` | `true` | Enable built-in ad blocker |
| `waitUntil` | `string\|string[]` | `'auto'` | Navigation wait condition |
| `timeout` | `number` | `30000` | Navigation timeout in ms |
| `device` | `string` | `'Macbook Pro 13'` | Device to emulate |
| `headers` | `object` | `{}` | Extra HTTP headers |
| `javascript` | `boolean` | `true` | Enable/disable JavaScript |
| `animations` | `boolean` | `false` | Enable CSS animations |
| `colorScheme` | `string` | — | `'light'` or `'dark'` preference |
| `mediaType` | `string` | — | CSS media type (`'screen'`, `'print'`) |
| `timezone` | `string` | — | Timezone to emulate |
| `authenticate` | `object` | — | HTTP authentication credentials |
| `scripts` | `string\|string[]` | — | Scripts to inject |
| `modules` | `string\|string[]` | — | ES modules to inject |
| `styles` | `string\|string[]` | — | Stylesheets to inject |
| `click` | `string\|string[]` | — | CSS selectors to click |
| `scroll` | `string` | — | CSS selector to scroll into view |
| `abortTypes` | `string[]` | `[]` | Resource types to abort |
| `waitForSelector` | `string` | — | Wait for selector to appear |
| `waitForFunction` | `string` | — | Wait for function to return truthy |
| `waitForTimeout` | `number` | — | Wait for specified milliseconds |
| `onPageRequest` | `function` | — | Request interception handler |

### Smart waiting with `waitUntil: 'auto'`

The default `'auto'` mode intelligently waits for page readiness:

```js
// Auto mode combines 'load' with 'networkidle2' smartly
await goto(page, { url: 'https://example.com', waitUntil: 'auto' })

// Standard Puppeteer wait conditions also supported
await goto(page, { url: 'https://example.com', waitUntil: 'networkidle0' })
await goto(page, { url: 'https://example.com', waitUntil: ['load', 'domcontentloaded'] })
```

### Built-in Ad Blocker

The package includes a precompiled [Ghostery ad-blocker](https://github.com/ghostery/adblocker) engine that blocks ads and trackers automatically:

```js
// Enabled by default
await goto(page, { url: 'https://example.com', adblock: true })

// Disable for specific pages
await goto(page, { url: 'https://example.com', adblock: false })

// The adblocker can be disabled mid-session
page.disableAdblock()
```

### Script and style injection

Inject external resources or inline code:

```js
await goto(page, {
  url: 'https://example.com',
  // External URLs
  scripts: ['https://cdn.example.com/library.js'],
  // ES modules
  modules: ['https://cdn.example.com/module.mjs'],
  // CSS (URLs, paths, or inline)
  styles: [
    'https://cdn.example.com/styles.css',
    'body { background: red; }'
  ]
})
```

### Request interception

Abort specific resource types to speed up navigation:

```js
await goto(page, {
  url: 'https://example.com',
  abortTypes: ['image', 'stylesheet', 'font', 'media'],
  onPageRequest: (request, page) => {
    console.log('Request:', request.url())
  }
})
```

### Device emulation

```js
// Use preset device
await goto(page, { url: 'https://example.com', device: 'iPhone 13' })

// Custom viewport
await goto(page, {
  url: 'https://example.com',
  viewport: { width: 1920, height: 1080 }
})

// Custom headers
await goto(page, {
  url: 'https://example.com',
  headers: {
    'user-agent': 'custom-agent',
    'cookie': 'session=abc123'
  }
})
```

### Return value

The `goto` function returns:

```js
const { response, device, error } = await goto(page, { url })

// response: Puppeteer Response object (or undefined if navigation failed)
// device: { userAgent, viewport } used for the request
// error: Error object if navigation failed
```

### How it fits in the monorepo

This is the **core navigation engine** used by the entire browserless ecosystem:

| Consumer | Purpose |
|----------|---------|
| `browserless` (core) | Powers `.goto()`, `.html()`, `.text()`, `.pdf()`, `.screenshot()` |
| `@browserless/screenshot` | Navigation before capturing screenshots |
| `@browserless/pdf` | Navigation before generating PDFs |
| `@browserless/function` | Navigation for sandboxed function execution |
| `@browserless/lighthouse` | Navigation for Lighthouse audits |

### Dependencies

| Package | Purpose |
|---------|---------|
| `@browserless/devices` | Device descriptor lookups and emulation |
| `@ghostery/adblocker-puppeteer` | Ad and tracker blocking |
| `debug-logfmt` | Structured debug logging |
| `got` | HTTP client for postinstall script |
| `is-url-http` | Detect if value is URL for injection |
| `p-reflect` / `p-timeout` | Promise utilities for timeouts |
| `shallow-equal` | Viewport comparison optimization |
| `tough-cookie` | Cookie string parsing |

## License

**@browserless/goto** © [Microlink](https://microlink.io), released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Microlink](https://microlink.io) with help from [contributors](https://github.com/microlinkhq/browserless/contributors).

The [logo](https://thenounproject.com/term/browser/288309/) has been designed by [xinh studio](https://xinh.studio).

> [microlink.io](https://microlink.io) · GitHub [microlinkhq](https://github.com/microlinkhq) · X [@microlinkhq](https://x.com/microlinkhq)
