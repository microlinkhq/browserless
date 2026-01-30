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

> @browserless/cli: CLI to interact with Browserless capabilities.

See [CLI section](https://browserless.js.org/#/?id=cli) our website for more information.

## Install

Using npm:

```sh
npm install @browserless/cli -g
```

## About

This package provides a **command-line interface** for interacting with browserless capabilities directly from your terminal. It exposes the `browserless` binary that wraps the core browserless API into easy-to-use shell commands.

### What this package does

The `@browserless/cli` package allows you to:

- **Take screenshots** from URLs with gradient backgrounds, browser overlays, and device emulation
- **Generate PDFs** from web pages
- **Extract content** as HTML or plain text
- **Run Lighthouse audits** for performance analysis
- **Analyze page weight** (network requests, transfer size, resource size)
- **Check URL status** and response information (redirects, headers, status codes)

### Available commands

| Command | Description |
|---------|-------------|
| `screenshot <url>` | Capture a screenshot with optional overlay and background |
| `pdf <url>` | Generate a PDF document from a web page |
| `html <url>` | Serialize the page content to HTML |
| `text <url>` | Extract plain text content from the page |
| `lighthouse <url>` | Run a Google Lighthouse audit and output JSON report |
| `page-weight <url>` | Analyze network requests and resource sizes |
| `ping <url>` | Get response info: status code, redirects, headers |
| `status <url>` | Get the HTTP status code |
| `goto <url>` | Navigate to a URL and return page/response info |

### How it fits in the monorepo
This package depends on:

| Dependency                | Purpose                                                 |
|---------------------------|---------------------------------------------------------|
| browserless               | Core API for all browser automation operations          |
| @browserless/lighthouse   | Lighthouse audit integration (used by lighthouse command) |

The CLI acts as a thin wrapper that parses command-line arguments, initializes a browserless instance, and delegates to the appropriate command handler.

## License

**@browserless/cli** © [Microlink](https://microlink.io), released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Microlink](https://microlink.io) with help from [contributors](https://github.com/microlinkhq/browserless/contributors).

The [logo](https://thenounproject.com/term/browser/288309/) has been designed by [xinh studio](https://xinh.studio).

> [microlink.io](https://microlink.io) · GitHub [microlinkhq](https://github.com/microlinkhq) · X [@microlinkhq](https://x.com/microlinkhq)
