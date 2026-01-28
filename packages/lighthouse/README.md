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

> @browserless/lighthouse: Browserless Lighthouse integration using puppeteer.

See the [lighthouse section](https://browserless.js.org/#/?id=lighthouse) on our website for more information.

## Install

Using npm:

```sh
npm install @browserless/lighthouse --save
```

## About

This package provides **Google Lighthouse integration** for browserless, allowing you to run performance, accessibility, SEO, and best practices audits on any URL using your existing browserless setup.

### What this package does

The `@browserless/lighthouse` package allows you to:

- **Run Lighthouse audits** with full performance, accessibility, SEO, and PWA analysis
- **Generate reports** in JSON, HTML, or CSV formats
- **Use Lighthouse presets** for desktop or mobile configurations
- **Customize audits** by selecting specific categories or skipping certain checks
- **Integrate seamlessly** with your existing browserless browser instance

### Usage

```js
const createLighthouse = require('@browserless/lighthouse')
const createBrowser = require('browserless')

// Create a browserless instance
const browser = createBrowser()

// Create the lighthouse function with teardown support
const lighthouse = createLighthouse(async teardown => {
  const browserless = await browser.createContext()
  teardown(() => browserless.destroyContext())
  return browserless
})

// Run an audit
const report = await lighthouse('https://example.com')
console.log(report.categories.performance.score)
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `output` | `string` | `'json'` | Report format: `'json'`, `'html'`, or `'csv'` |
| `timeout` | `number` | — | Audit timeout in milliseconds |
| `preset` | `string` | — | Lighthouse preset: `'lr-desktop'`, `'lr-mobile'`, etc. |
| `flags` | `object` | — | [Lighthouse flags](https://github.com/GoogleChrome/lighthouse/blob/main/docs/configuration.md) |
| `onlyAudits` | `string[]` | — | Run only specific audits |
| `skipAudits` | `string[]` | — | Skip specific audits |
| `onlyCategories` | `string[]` | — | Run only specific categories |

### Output formats

```js
// JSON (default) - returns the Lighthouse Result object (lhr)
const jsonReport = await lighthouse(url, { output: 'json' })
console.log(jsonReport.categories.performance) // 0.95

// HTML - returns the full HTML report as a string
const htmlReport = await lighthouse(url, { output: 'html' })
await fs.writeFile('report.html', htmlReport)

// CSV - returns CSV-formatted data
const csvReport = await lighthouse(url, { output: 'csv' })
```

### Lighthouse presets

Use built-in Lighthouse presets for common configurations:

```js
// Desktop configuration (higher viewport, no throttling)
const report = await lighthouse(url, { preset: 'lr-desktop' })

// Mobile configuration (smaller viewport, CPU/network throttling)
const report = await lighthouse(url, { preset: 'lr-mobile' })
```

### Customizing audits

```js
// Run only accessibility audits
const report = await lighthouse(url, {
  onlyAudits: ['accessibility']
})

// Run only specific categories
const report = await lighthouse(url, {
  onlyCategories: ['performance', 'accessibility']
})

// Skip specific audits
const report = await lighthouse(url, {
  skipAudits: ['uses-http2', 'bf-cache']
})
```

### Report structure (JSON)

When using JSON output, the report includes:

```js
const report = await lighthouse(url)

// Categories with scores (0-1)
report.categories.performance.score      // Performance score
report.categories.accessibility.score    // Accessibility score
report.categories.seo.score              // SEO score
report.categories['best-practices'].score // Best practices score
report.categories.pwa.score              // PWA score (if applicable)

// Individual audits
report.audits['first-contentful-paint'].numericValue  // FCP in ms
report.audits['largest-contentful-paint'].numericValue // LCP in ms
report.audits['cumulative-layout-shift'].numericValue  // CLS score
report.audits['total-blocking-time'].numericValue      // TBT in ms

// Configuration used
report.configSettings
```

### CLI usage

The `@browserless/cli` package includes a lighthouse command:

```bash
browserless lighthouse https://example.com > report.json
```

### How it fits in the monorepo

This is an **extended functionality package** for performance auditing:

| Consumer | Purpose |
|----------|---------|
| `@browserless/cli` | Powers the `browserless lighthouse` command |
| User applications | Performance monitoring, CI/CD quality gates |

### Dependencies

| Package | Purpose |
|---------|---------|
| `lighthouse` | Google Lighthouse core library |

## License

**@browserless/lighthouse** © [Microlink](https://microlink.io), released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Microlink](https://microlink.io) with help from [contributors](https://github.com/microlinkhq/browserless/contributors).

The [logo](https://thenounproject.com/term/browser/288309/) has been designed by [xinh studio](https://xinh.studio).

> [microlink.io](https://microlink.io) · GitHub [microlinkhq](https://github.com/microlinkhq) · X [@microlinkhq](https://x.com/microlinkhq)
