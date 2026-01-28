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

## Install

Using npm:

```sh
npm install browserless puppeteer --save
```

## About

This is the **core package** of the browserless monorepo. It provides a high-level, performance-oriented API for headless Chrome/Chromium automation built on top of [Puppeteer](https://github.com/puppeteer/puppeteer).

### What this package does

The `browserless` package serves as the main entry point and orchestrator for the entire browserless ecosystem. It handles:

- **Browser process management**: Spawns and manages headless Chrome/Chromium processes with optimized flags for performance and stability. Includes automatic respawning when the browser disconnects.

- **Browser context isolation**: Creates isolated browser contexts (similar to browser tabs) with separate cookies and cache, enabling concurrent operations without cross-contamination.

- **Built-in methods**: Provides ready-to-use methods for common tasks:
  - `html(url)` – Serialize page content to HTML
  - `text(url)` – Extract plain text from a page
  - `pdf(url)` – Generate PDF documents
  - `screenshot(url)` – Capture screenshots with device emulation and overlay support

- **Reliability features**: Built-in retry logic, timeout handling, and graceful error recovery for production environments.

### How it fits in the monorepo

This package integrates and re-exports functionality from other `@browserless/*` packages:

| Dependency | Purpose |
|------------|---------|
| `@browserless/goto` | Page navigation with smart waiting strategies, ad blocking, and evasion techniques |
| `@browserless/screenshot` | Screenshot capture with overlays, device emulation, and code highlighting |
| `@browserless/pdf` | PDF generation with customizable margins and scaling |
| `@browserless/errors` | Standardized error handling and timeout errors |

## License

**browserless** © [Microlink](https://microlink.io), released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Microlink](https://microlink.io) with help from [contributors](https://github.com/microlinkhq/browserless/contributors).

The [logo](https://thenounproject.com/term/browser/288309/) has been designed by [xinh studio](https://xinh.studio).

> [microlink.io](https://microlink.io) · GitHub [microlinkhq](https://github.com/microlinkhq) · X [@microlinkhq](https://x.com/microlinkhq)
