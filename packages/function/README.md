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

> @browserless/function: Run abritrary JavaScript inside a browser sandbox.

See [function section](https://browserless.js.org/#/?id=function) our website for more information.

## Install

Using npm:

```sh
npm install @browserless/function --save
```

## About

This package provides a **secure sandbox** for running arbitrary JavaScript code with runtime access to a browser page. It executes user-provided functions in an isolated VM environment, with optional access to Puppeteer's page API.

### What this package does

The `@browserless/function` package allows you to:

- **Execute arbitrary JavaScript** in a secure, isolated VM sandbox
- **Access the browser page** from within the sandbox for DOM manipulation
- **Capture console output** and execution profiling data
- **Pass custom data** to the sandboxed function at runtime
- **Handle errors gracefully** with structured result objects

### Usage

```js
const createFunction = require('@browserless/function')

// Simple function without page access
const code = ({ query }) => query.value * 2

const myFn = createFunction(code)
const result = await myFn('https://example.com', { query: { value: 21 } })

console.log(result)
// => { isFulfilled: true, value: 42, profiling: {...}, logging: {...} }
```

### Accessing the page

When your code references `page`, browserless automatically provides access to the Puppeteer page:

```js
const createFunction = require('@browserless/function')

// Function with page access
const code = async ({ page }) => {
  const title = await page.title()
  const content = await page.evaluate(() => document.body.innerText)
  return { title, content }
}

const scraper = createFunction(code)
const result = await scraper('https://example.com')

console.log(result)
// => { isFulfilled: true, value: { title: 'Example', content: '...' }, ... }
```

### Available context

The sandboxed function receives these properties:

| Property | Description |
|----------|-------------|
| `page` | Puppeteer [Page](https://pptr.dev/api/puppeteer.page) object (if referenced in code) |
| `device` | Device descriptor with `userAgent` and `viewport` |
| `...opts` | Any custom options passed at runtime |

### Result object

The function returns a structured result:

| Property | Description |
|----------|-------------|
| `isFulfilled` | `true` if execution succeeded, `false` if error |
| `value` | Return value (success) or error object (failure) |
| `profiling` | Execution timing and performance data |
| `logging` | Captured console output (`log`, `warn`, `error`, etc.) |

### Options

```js
const myFn = createFunction(code, {
  // Browserless instance factory
  getBrowserless: () => require('browserless')(),
  
  // Number of retries on failure
  retry: 2,
  
  // Execution timeout in milliseconds
  timeout: 30000,
  
  // Options passed to browserless.goto()
  gotoOpts: {
    scripts: ['https://cdn.example.com/library.js'],
    waitUntil: 'networkidle0'
  },
  
  // VM sandbox options (passed to isolated-function)
  vmOpts: { /* ... */ }
})
```

### Examples

#### Interact with page elements

```js
const createFunction = require('@browserless/function')

const code = async ({ page }) => {
  await page.waitForSelector('button.submit')
  await page.type('input', 'test@test.com', { delay: 200 })
  await page.click('button.submit')
  await page.waitForNavigation()
  return page.title()
}

const clickAndGetTitle = createFunction(code)
const result = await clickAndGetTitle('https://example.com')
```

#### Inject external scripts

```js
const createFunction = require('@browserless/function')

const code = ({ page }) => page.evaluate('jQuery.fn.jquery')

const getjQueryVersion = createFunction(code, {
  gotoOpts: {
    scripts: ['https://code.jquery.com/jquery-3.6.0.min.js']
  }
})

const result = await getjQueryVersion('https://example.com')
// => { isFulfilled: true, value: '3.6.0', ... }
```

#### Use npm modules in sandbox

```js
const createFunction = require('@browserless/function')

const code = async ({ page }) => {
  const _ = require('lodash')
  const text = await page.evaluate(() => document.body.innerText)
  return _.words(text).length
}

const countWords = createFunction(code)
const result = await countWords('https://example.com')
```

#### Handle errors

```js
const createFunction = require('@browserless/function')

const code = () => {
  throw new Error('Something went wrong')
}

const myFn = createFunction(code)
const result = await myFn('https://example.com')

console.log(result.isFulfilled) // => false
console.log(result.value.message) // => 'Something went wrong'
```

### How it fits in the monorepo

This is an **extended functionality package** for advanced use cases. It makes the repository more extensible and customizable for any edge case you may encounter.

### Dependencies

| Package | Purpose |
|---------|---------|
| `@browserless/errors` | Error normalization and typed errors |
| `isolated-function` | Secure VM sandbox execution |
| `require-one-of` | Auto-detects browserless installation |
| `acorn` / `acorn-walk` | AST parsing to detect page usage in code |

## License

**@browserless/functions** © [Microlink](https://microlink.io), released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Microlink](https://microlink.io) with help from [contributors](https://github.com/microlinkhq/browserless/contributors).

The [logo](https://thenounproject.com/term/browser/288309/) has been designed by [xinh studio](https://xinh.studio).

> [microlink.io](https://microlink.io) · GitHub [microlinkhq](https://github.com/microlinkhq) · X [@microlinkhq](https://x.com/microlinkhq)
