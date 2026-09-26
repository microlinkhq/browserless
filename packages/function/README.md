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

> @browserless/function: Run arbitrary JavaScript inside a browser sandbox.

See the [function section](https://browserless.js.org/#/?id=function) on our website for more information.

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

First, create a function instance by calling the factory:

```js
const createFunction = require('@browserless/function')()
```

You can optionally pass a `tmpdir` for the sandbox working directory:

```js
const createFunction = require('@browserless/function')({ tmpdir: '/tmp/functions' })
```

Then use it to run arbitrary JavaScript:

```js
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
const createFunction = require('@browserless/function')()

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
| `url` | Target URL passed to the function (no browser required) |
| `page` | Puppeteer [Page](https://pptr.dev/api/puppeteer.page) object (if referenced in code) |
| `device` | Device descriptor with `userAgent` and `viewport` |
| `...opts` | Any custom options passed at runtime |

### Result object

The function returns a structured result:

| Property | Description |
|----------|-------------|
| `isFulfilled` | `true` if execution succeeded, `false` if error |
| `value` | Return value (success) or error object (failure) |
| `profiling` | Execution timing and resource usage (see below) |
| `logging` | Captured console output (`log`, `warn`, `error`, etc.) |

#### Profiling

The `profiling` object contains phased timing and resource data:

| Property | Description |
|----------|-------------|
| `phases.compile` | Time to compile the sandbox script (ms) |
| `phases.spawn` | Time to spawn the child process (ms) |
| `phases.run` | Time executing the user function (ms) |
| `phases.total` | Total wall-clock time (ms) |
| `cpu` | CPU time consumed (ms) |
| `memory` | Peak memory usage (bytes) |

### Teardown

Call `.teardown()` on the factory instance to clean up sandbox resources:

```js
const createFunction = require('@browserless/function')({ tmpdir: '/tmp/functions' })

// ... use createFunction ...

await createFunction.teardown()
```

### extendPage

Attach extra methods on `page`. JSON values become async getters. Functions are inlined as async methods (`this` is the page; use a function, not an arrow, when you need `this`). If the user function only uses these methods, Chromium is not started:

```js
const myFn = createFunction(({ page }) => page.html(), {
  extendPage: { url, html }
})

const result = await myFn('https://example.com')
// => { isFulfilled: true, value: html, ... }
```

### Options

```js
const myFn = createFunction(code, {
  // Browserless instance factory
  getBrowserless: () => require('browserless')(),
  
  // Attempts on the `getPage` path, where there is no context to replace and
  // this is the only retry. The default path takes its retry count from the
  // browserless context instead.
  retry: 2,
  
  // Execution timeout in milliseconds
  timeout: 30000,
  
  // Extra methods on `page`. JSON values become async getters; functions
  // are inlined as async methods. If the function only uses these methods,
  // Chromium is not started.
  extendPage: {
    url,
    html
  },

  // Options passed to browserless.goto()
  gotoOpts: {
    scripts: ['https://cdn.example.com/library.js'],
    waitUntil: 'networkidle0'
  },
  
  // VM sandbox options (passed to isolated-function)
  vmOpts: { /* ... */ },

  // Set false when `getBrowserless` hands back a context you own and keep
  // using. This call neither destroys it nor replaces it on a retryable
  // browser error, so a sibling task sharing it does not lose its pages.
  ownsContext: true,

  // Run against a page that is already navigated, instead of creating a
  // context and navigating. No `goto` happens and the page is never closed:
  // whoever supplied it owns its lifetime. Pass `response` when you have it,
  // so the function still sees `_response`. `timeout` bounds how long the
  // caller waits. It leaves the page open, and the snippet plus its isolate
  // subprocess keep running until the snippet returns or the page is closed.
  getPage: async () => ({ page, device, response })
})
```

Reusing a page the caller already loaded, so the target is fetched once:

```js
const { page, response } = await somethingThatAlreadyNavigated(url)

const result = await createFunction(code, {
  getPage: async () => ({ page, response })
})(url)

await page.close()
```

`timeout` rejects the call and leaves the page open. The snippet and its
isolate subprocess keep running, so treat the page as busy: leave it alone
until that work finishes, or close it. Closing the page ends the snippet.

Retaining a page from `browserless` requires `keepPage`, since `evaluate`
closes its page as soon as it resolves:

```js
let page
await context.evaluate(
  currentPage => {
    page = currentPage
    return currentPage.content()
  },
  { keepPage: true }
)(url)
```

Retaining a page restarts its close watchdog. The new window is the
`evaluate` / `withPage` timeout, measured from handover. Finish or close the
page before that window ends. A later `getPage` call has its own timeout; the
watchdog still closes the page when the evaluate window ends, including while
that call is in progress. Set the evaluate timeout long enough to cover the
follow-up work.

### Examples

#### Interact with page elements

```js
const createFunction = require('@browserless/function')()

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
const createFunction = require('@browserless/function')()

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
const createFunction = require('@browserless/function')()

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
const createFunction = require('@browserless/function')()

const code = () => {
  throw new Error('Something went wrong')
}

const myFn = createFunction(code)
const result = await myFn('https://example.com')

console.log(result.isFulfilled) // => false
console.log(result.value.message) // => 'Something went wrong'
```

### How it fits in the monorepo

This is an **extended functionality package**. It is not wired into `browserless` core — install it when you need a sandbox that can touch a page.

### Dependencies

| Package | Purpose |
|---------|---------|
| `@browserless/errors` | Error normalization and typed errors |
| `isolated-function` | Secure sandboxed execution via child processes |
| `require-one-of` | Auto-detects browserless installation |
| `acorn` / `acorn-walk` | AST parsing to detect page usage in code |

## License

**@browserless/function** © [Microlink](https://microlink.io), released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Microlink](https://microlink.io) with help from [contributors](https://github.com/microlinkhq/browserless/contributors).

The [logo](https://thenounproject.com/term/browser/288309/) has been designed by [xinh studio](https://xinh.studio).

> [microlink.io](https://microlink.io) · GitHub [microlinkhq](https://github.com/microlinkhq) · X [@microlinkhq](https://x.com/microlinkhq)
