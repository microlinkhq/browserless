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

> @browserless/errors: A collection of qualified errors for Puppeteer.

## Install

Using npm:

```sh
npm install @browserless/errors --save
```

## About

This package provides **standardized, qualified error types** for Puppeteer and browserless operations. It normalizes raw browser errors into consistent, typed errors with unique error codes for easier debugging and error handling.

### What this package does

The `@browserless/errors` package allows you to:

- **Create typed errors** with consistent structure and error codes
- **Normalize raw errors** from Puppeteer into qualified `BrowserlessError` instances
- **Identify error types** programmatically using error codes
- **Debug errors** with built-in serialization and logging

### Error Types

| Error Factory | Code | Description |
|---------------|------|-------------|
| `browserTimeout` | `EBRWSRTIMEOUT` | Promise or navigation timed out |
| `protocolError` | `EPROTOCOL` | Chrome DevTools Protocol error |
| `evaluationFailed` | `EFAILEDEVAL` | Page evaluation/script execution failed |
| `contextDisconnected` | `EBRWSRCONTEXTCONNRESET` | Browser context connection was reset |

### Usage

```js
const errors = require('@browserless/errors')

// Create a timeout error
const timeoutError = errors.browserTimeout({ timeout: 30000 })
// => BrowserlessError: EBRWSRTIMEOUT, Promise timed out after 30000 milliseconds

// Create a protocol error
const protocolError = errors.protocolError({ message: 'Target closed.' })
// => BrowserlessError: EPROTOCOL, Target closed.

// Create an evaluation error
const evalError = errors.evaluationFailed({ message: 'foo is not defined' })
// => BrowserlessError: EFAILEDEVAL, foo is not defined

// Normalize a raw error from Puppeteer
const rawError = { message: 'Protocol error (Runtime.callFunctionOn): Target closed.' }
const normalizedError = errors.ensureError(rawError)
// => BrowserlessError: EPROTOCOL, Target closed.

// Check if an error is a BrowserlessError
if (errors.isBrowserlessError(error)) {
  console.log('Error code:', error.code)
}
```

### Error properties

All `BrowserlessError` instances include:

| Property | Description |
|----------|-------------|
| `name` | Always `'BrowserlessError'` |
| `code` | Unique error code (e.g., `EBRWSRTIMEOUT`) |
| `message` | Human-readable error message prefixed with the code |

### How it fits in the monorepo

This is a **foundational utility package** used throughout the browserless ecosystem:

| Consumer | Purpose |
|----------|---------|
| `browserless` (core) | Wraps operations with timeout errors, normalizes caught errors |
| `@browserless/goto` | Handles navigation and protocol errors |
| `@browserless/screenshot` | Handles screenshot capture errors |
| `@browserless/pdf` | Handles PDF generation errors |

### Dependencies

| Package | Purpose |
|---------|---------|
| `whoops` | Error factory for creating typed errors with codes |
| `ensure-error` | Ensures values are proper Error instances |
| `serialize-error` | Serializes errors for debug logging |
| `debug-logfmt` | Structured debug logging |

## License

**@browserless/errors** © [Microlink](https://microlink.io), released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Microlink](https://microlink.io) with help from [contributors](https://github.com/microlinkhq/browserless/contributors).

The [logo](https://thenounproject.com/term/browser/288309/) has been designed by [xinh studio](https://xinh.studio).

> [microlink.io](https://microlink.io) · GitHub [microlinkhq](https://github.com/microlinkhq) · X [@microlinkhq](https://x.com/microlinkhq)
