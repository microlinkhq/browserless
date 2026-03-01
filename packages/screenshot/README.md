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

> @browserless/screenshot: Take a clean screenshot of any website.

See the [screenshot section](https://browserless.js.org/#/?id=screenshoturl-options) on our website for more information.

## Install

Using npm:

```sh
npm install @browserless/screenshot --save
```

## About

This package provides **advanced screenshot capture** with smart defaults, browser frame overlays, gradient backgrounds, and automatic code syntax highlighting. It wraps Puppeteer's `page.screenshot()` with features optimized for production use.

### What This Package Does

The `@browserless/screenshot` package allows you to:

- **Capture screenshots** with device emulation and smart waiting
- **Add browser frame overlays** (dark or light theme)
- **Apply gradient or image backgrounds** for social media-ready images
- **Auto-detect blank screenshots** and retry until content renders
- **Syntax highlight code** (JSON, text) with Prism.js themes
- **Capture specific elements** using CSS selectors
- **Take full-page screenshots** with lazy-loaded content support

### Usage

```js
const createScreenshot = require('@browserless/screenshot')
const createGoto = require('@browserless/goto')

const goto = createGoto({ timeout: 30000 })
const screenshot = createScreenshot({ goto })

// With browserless
const browserless = await browser.createContext()
const buffer = await browserless.screenshot('https://example.com')

// With overlay
const buffer = await browserless.screenshot('https://example.com', {
  overlay: {
    browser: 'dark',
    background: 'linear-gradient(45deg, #FF057C 0%, #8D0B93 50%, #321575 100%)'
  }
})
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `type` | `string` | `'png'` | Image format: `'png'`, `'jpeg'`, `'webp'` |
| `quality` | `number` | — | Quality (0-100) for JPEG/WebP |
| `fullPage` | `boolean` | `false` | Capture full scrollable page |
| `element` | `string` | — | CSS selector for element screenshot |
| `codeScheme` | `string` | `'atom-dark'` | Prism.js theme for code highlighting |
| `waitUntil` | `string` | `'auto'` | When to consider navigation done |
| `waitForDom` | `number` | `0` | DOM stability window in ms (idle is `waitForDom / 10`, `0` disables DOM wait) |
| `isPageReady` | `function` | `({ isWhite }) => !isWhite` | Custom readiness predicate for retry loop |
| `overlay` | `object` | `{}` | Browser overlay options |

All [Puppeteer page.screenshot() options](https://pptr.dev/api/puppeteer.screenshotoptions) are supported.

### Browser Overlay

Add a browser frame around your screenshot for a polished look:

```js
const buffer = await browserless.screenshot(url, {
  overlay: {
    // Browser frame theme: 'dark' or 'light'
    browser: 'dark',
    
    // Background: color, gradient, or image URL
    background: 'linear-gradient(225deg, #FF057C 0%, #8D0B93 50%, #321575 100%)',
    
    // Margin around the screenshot (default: 0.2 = 20%)
    margin: 0.2
  }
})
```

#### Background Options

```js
// Solid color
overlay: { background: '#c1c1c1' }

// CSS gradient
overlay: { background: 'linear-gradient(45deg, #12c2e9, #c471ed, #f64f59)' }

// Image URL
overlay: { background: 'https://source.unsplash.com/random/1920x1080' }
```

### Element Screenshots

Capture a specific DOM element:

```js
const buffer = await browserless.screenshot(url, {
  element: '.hero-section'
})

// The package waits for the element to be visible
const buffer = await browserless.screenshot(url, {
  element: '#main-content'
})
```

### Full Page Screenshots

Capture the entire scrollable page with lazy-loaded content:

```js
const buffer = await browserless.screenshot(url, {
  fullPage: true
})
```

The package automatically:
1. Waits for DOM stability
2. Scrolls through the page to trigger lazy-loaded images
3. Scrolls back to top
4. Takes the screenshot

### Code Syntax Highlighting

When the response is JSON or plain text, the package automatically renders it with syntax highlighting:

```js
// Screenshot of a JSON API response
const buffer = await browserless.screenshot('https://api.example.com/data', {
  codeScheme: 'atom-dark'  // or any Prism.js theme
})
```

Available themes from [prism-themes](https://github.com/PrismJS/prism-themes):
- `atom-dark`, `ghcolors`, `dracula`, `duotone-dark`, `duotone-light`, `material-dark`, `material-light`, `nord`, `synthwave84`, and more

### Smart Content Detection

When `waitUntil: 'auto'` (the default), the package:

1. Navigates to the page
2. Waits for fonts to load
3. Waits for images in viewport to decode
4. Takes a screenshot
5. If the screenshot is blank/white, retries with additional waiting

This ensures JavaScript-rendered content is fully loaded.

### Examples

#### Social media card

```js
const buffer = await browserless.screenshot('https://example.com', {
  device: 'iPhone 13',
  overlay: {
    browser: 'light',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
  }
})
```

#### API documentation screenshot

```js
const buffer = await browserless.screenshot('https://api.example.com/docs', {
  fullPage: true,
  type: 'jpeg',
  quality: 85
})
```

#### Specific component

```js
const buffer = await browserless.screenshot('https://example.com', {
  element: '[data-testid="pricing-table"]',
  type: 'png'
})
```

### Architecture

```
@browserless/screenshot
├── src/
│   ├── index.js            → Main screenshot logic with smart waiting
│   ├── is-white-screenshot.js → Blank screenshot detection using Jimp
│   ├── time-span.js        → Timing utility
│   ├── overlay/
│   │   ├── index.js        → Browser frame and background composition
│   │   ├── dark.png        → Dark browser frame
│   │   └── light.png       → Light browser frame
│   └── pretty/
│       ├── index.js        → Code content detection and rendering
│       ├── html.js         → HTML template for code display
│       ├── prism.js        → Prism.js syntax highlighter
│       └── theme.js        → Prism theme loader
└── test/
    └── index.js            → Tests
```

### How It Fits in the Monorepo

This is a **core functionality package** for screenshot capture:

| Consumer | Purpose |
|----------|---------|
| `browserless` (core) | Provides the `.screenshot()` method |
| `@browserless/cli` | Powers the `browserless screenshot` command |
| `@browserless/pdf` | Uses `isWhiteScreenshot` for content detection |

### Dependencies

| Package | Purpose |
|---------|---------|
| `@browserless/goto` | Page navigation with ad blocking |
| `sharp` | Image composition for overlays; White/blank screenshot detection |
| `prism-themes` | Syntax highlighting themes |
| `svg-gradient` | Generate gradient backgrounds |
| `got` | Fetch remote background images |
| `is-html-content` | Detect if content is HTML vs code |

## License

**@browserless/screenshot** © [Microlink](https://microlink.io), released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Microlink](https://microlink.io) with help from [contributors](https://github.com/microlinkhq/browserless/contributors).

The [logo](https://thenounproject.com/term/browser/288309/) has been designed by [xinh studio](https://xinh.studio).

> [microlink.io](https://microlink.io) · GitHub [microlinkhq](https://github.com/microlinkhq) · X [@microlinkhq](https://x.com/microlinkhq)
