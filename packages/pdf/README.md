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

> @browserless/pdf: Sensible good defaults for exporting a website as PDF.

See the [pdf section](https://browserless.js.org/#/?id=pdfurl-options) on our website for more information.

## Install

Using npm:

```sh
npm install @browserless/pdf --save
```

## About

This package provides **PDF generation** from web pages with sensible defaults and smart content detection. It wraps Puppeteer's `page.pdf()` with optimized settings and a retry mechanism to ensure the page is fully rendered before generating the PDF.

### What this package does

The `@browserless/pdf` package allows you to:

- **Generate PDFs** from any URL with production-ready defaults
- **Auto-detect content rendering** using white screenshot detection
- **Customize margins** with a simple string or per-side configuration
- **Scale content** to fit pages optimally
- **Use all Puppeteer PDF options** for advanced customization

### Usage

```js
const createPdf = require('@browserless/pdf')
const createGoto = require('@browserless/goto')

const goto = createGoto({ timeout: 30000 })
const pdf = createPdf({ goto })

// With browserless
const browserless = await browser.createContext()
const pdfBuffer = await browserless.pdf('https://example.com')

// Or directly with a page
const page = await browser.newPage()
const pdfFn = pdf(page)
const pdfBuffer = await pdfFn('https://example.com')
```

### Default settings

The package applies these optimized defaults:

| Option | Default | Description |
|--------|---------|-------------|
| `margin` | `'0.35cm'` | Page margins (applied to all sides) |
| `scale` | `0.65` | Content scale factor for optimal fit |
| `printBackground` | `true` | Include background colors/images |
| `waitUntil` | `'auto'` | Smart waiting with content detection |

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `margin` | `string \| object` | `'0.35cm'` | Page margins |
| `scale` | `number` | `0.65` | Scale of the webpage rendering (0.1 - 2) |
| `printBackground` | `boolean` | `true` | Print background graphics |
| `waitUntil` | `string` | `'auto'` | When to consider navigation done |
| `waitForDom` | `number` | `0` | DOM stability window in ms (idle is `waitForDom / 10`, `0` disables DOM wait) |
| `format` | `string` | `'Letter'` | Paper format (A4, Letter, etc.) |
| `landscape` | `boolean` | `false` | Paper orientation |
| `width` | `string \| number` | — | Paper width (overrides format) |
| `height` | `string \| number` | — | Paper height (overrides format) |
| `pageRanges` | `string` | — | Paper ranges to print, e.g., '1-5, 8' |
| `headerTemplate` | `string` | — | HTML template for header |
| `footerTemplate` | `string` | — | HTML template for footer |
| `displayHeaderFooter` | `boolean` | `false` | Display header and footer |
| `preferCSSPageSize` | `boolean` | `false` | Give priority to CSS @page size |

All [Puppeteer page.pdf() options](https://pptr.dev/api/puppeteer.pdfoptions) are supported.

### Margin configuration

Set margins as a single value (applied to all sides) or per-side:

```js
// Single value for all sides
await browserless.pdf(url, { margin: '1cm' })

// Per-side configuration
await browserless.pdf(url, {
  margin: {
    top: '2cm',
    right: '1cm',
    bottom: '2cm',
    left: '1cm'
  }
})
```

Supported units: `px`, `in`, `cm`, `mm`

### Smart content detection

When `waitUntil: 'auto'` (the default), the package:

1. Navigates to the page
2. Optionally waits for DOM stability (`waitForDom`, default `0` = disabled)
3. Takes a low-quality screenshot to check for white/blank content
4. If the page appears blank, retries until content is detected
5. Generates the PDF once content is confirmed

This ensures dynamic content (JavaScript-rendered pages) is fully loaded before PDF generation.

```js
// Use auto detection (default)
await browserless.pdf(url, { waitUntil: 'auto' })

// Or use standard Puppeteer wait conditions
await browserless.pdf(url, { waitUntil: 'networkidle0' })
await browserless.pdf(url, { waitUntil: 'domcontentloaded' })
```

### Examples

#### Basic PDF generation

```js
const pdfBuffer = await browserless.pdf('https://example.com')
await fs.writeFile('output.pdf', pdfBuffer)
```

#### A4 format with custom margins

```js
const pdfBuffer = await browserless.pdf('https://example.com', {
  format: 'A4',
  margin: '2cm',
  scale: 0.8
})
```

#### Landscape with header/footer

```js
const pdfBuffer = await browserless.pdf('https://example.com', {
  landscape: true,
  displayHeaderFooter: true,
  headerTemplate: '<div style="font-size:10px; text-align:center; width:100%;">Header</div>',
  footerTemplate: '<div style="font-size:10px; text-align:center; width:100%;"><span class="pageNumber"></span>/<span class="totalPages"></span></div>'
})
```

#### Print specific pages

```js
const pdfBuffer = await browserless.pdf('https://example.com', {
  pageRanges: '1-3, 5'
})
```

### How it fits in the monorepo

This is a **core functionality package** for PDF generation:

| Consumer | Purpose |
|----------|---------|
| `browserless` (core) | Provides the `.pdf()` method |
| `@browserless/cli` | Powers the `browserless pdf` command |

### Dependencies

| Package | Purpose |
|---------|---------|
| `@browserless/goto` | Page navigation with ad blocking |
| `@browserless/screenshot` | White screen detection for content verification |
| `@kikobeats/time-span` | Timing measurements for retry logic |
| `debug-logfmt` | Structured debug logging |
| `pretty-ms` | Human-readable time formatting |

## License

**@browserless/pdf** © [Microlink](https://microlink.io), released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Microlink](https://microlink.io) with help from [contributors](https://github.com/microlinkhq/browserless/contributors).

The [logo](https://thenounproject.com/term/browser/288309/) has been designed by [xinh studio](https://xinh.studio).

> [microlink.io](https://microlink.io) · GitHub [microlinkhq](https://github.com/microlinkhq) · X [@microlinkhq](https://x.com/microlinkhq)
