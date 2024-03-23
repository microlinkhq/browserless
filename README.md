<h1 align="center">
  <img style="width: 500px; margin:3rem 0 1.5rem;" src="https://github.com/microlinkhq/browserless/raw/master/static/logo-banner.png#gh-light-mode-only" alt="browserless">
  <img style="width: 500px; margin:3rem 0 1.5rem;" src="https://github.com/microlinkhq/browserless/raw/master/static/logo-banner-light.png#gh-dark-mode-only" alt="browserless">
  <br>
</h1>

![Last version](https://img.shields.io/github/tag/microlinkhq/browserless.svg?style=flat-square)
[![Coverage Status](https://img.shields.io/coveralls/microlinkhq/browserless.svg?style=flat-square)](https://coveralls.io/github/microlinkhq/browserless)
[![NPM Status](https://img.shields.io/npm/dm/browserless.svg?style=flat-square)](https://www.npmjs.org/package/browserless)

> **browserless** is an efficient way to interact with a headless browser built on top of [puppeteer](https://github.com/GoogleChrome/puppeteer).

## Highlights

- Compatible with Puppeteer API ([text](texturl-options), [screenshot](#screenshoturl-options), [html](#htmlurl-options), [pdf](#pdfurl-options)).
- Built-in [adblocker](#adblock) for canceling unnecessary requests.
- Shell interaction via [Browserless CLI](command-line-interface).
- Easy [Google Lighthouse](#lighthouse) integration.
- Automatic retry & error handling.
- Sensible good defaults.

## Installation

You can install it via npm:

```bash
$ npm install browserless puppeteer --save
```

**browserless** is backed by [puppeteer](https://github.com/GoogleChrome/puppeteer), so you need to install it as well.

You can use it next to [`puppeteer`](https://www.npmjs.com/package/puppeteer), [`puppeteer-core`](https://www.npmjs.com/package/puppeteer-core) or [`puppeteer-firefox`](https://www.npmjs.com/package/puppeteer-firefox), interchangeably.

## Usage

This is a full example showcasing all the **browserless** capabilities:

```js
const createBrowser = require('browserless')
const termImg = require('term-img')

// First, create a browserless factory
// that it will keep a singleton process running
const browser = createBrowser()

// After that, you can create as many browser context
// as you need. The browser contexts won't share cookies/cache
// with other browser contexts.
const browserless = await browser.createContext()

// Perform the action you want, e.g., getting the HTML markup
const buffer = await browserless.screenshot('http://example.com', {
  device: 'iPhone 6'
})

console.log(termImg(buffer))

// After your task is done, destroy your browser context
await browserless.destroyContext()

// At the end, gracefully shutdown the browser process
await browser.close()
```

As you can see, **browserless** is implemented using a single browser process and creating/destroying specific browser contexts.

If you're already using puppeteer, you can upgrade to use **browserless** instead almost with no effort.

Additionally, you can use some specific [packages](#packages) in your codebase, interacting with them from puppeteer.

## CLI

With the command-line interface (CLI) you can interact with browserless methods using a terminal, or through an automated system:

<div style="margin: auto;">
  <video poster="/static/cli.png" loop="" controls="" src="https://github.com/microlinkhq/browserless/assets/2096101/5200b2c5-d930-40e7-b128-6d23a6974c28" style="width: 100%;border-radius: 4px;" autoplay=""></video>
</div>

Just install [`@browserless/cli`](https://npm.im/@browserless/cli) globally in your system using your favorite package manager:

```
npm install -g @browserless/cli
```

## Initializing a browser

The **browserless** main method is for creating a headless browser.

```js
const createBrowser = require('browserless')

const browser = createBrowser({
  timeout: 25000,
  lossyDeviceName: true,
  ignoreHTTPSErrors: true
})
```

Once the browser is initialized, some browser high-level methods are available:

```js
// Now, just call `createContext` for creating a browser tab
const browserless = await browser.createContext({ retry: 2 })

const buffer = await browserless.screenshot('https://example.com')

// You call `destroyContext` to close the browser tab.
await browserless.destroyContext()
```

The browser keeps running until you explicitly close it:

```js
// At the end, gracefully shutdown the browser process
await browser.close()
```

### .constructor(options)

You can pass any [puppeteer.launch#options](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#puppeteerlaunchoptions).

Additionally, you can setup:

##### defaultDevice

type: `string`</br>
default: `'Macbook Pro 13'`

Sets a consistent device viewport for each page.

##### lossyDeviceName

type: `boolean`</br>
default: `false`

It enables lossy detection over the device descriptor input.

```js
const browserless = require('browserless')({ lossyDeviceName: true })

browserless.getDevice({ device: 'macbook pro 13' })
browserless.getDevice({ device: 'MACBOOK PRO 13' })
browserless.getDevice({ device: 'macbook pro' })
browserless.getDevice({ device: 'macboo pro' })
```

This setting is oriented for find the device even if the descriptor device name is not exactly the same.

##### mode

type: `string`</br>
default: `launch`</br>
values: `'launch'` | `'connect'`

It defines if a browser should be spawned using [puppeteer.launch](https://github.com/puppeteer/puppeteer/blob/v5.5.0/docs/api.md#puppeteerlaunchoptions) or [puppeteer.connect](https://github.com/puppeteer/puppeteer/blob/v5.5.0/docs/api.md#puppeteerconnectoptions)

##### timeout

type: `number`</br>
default: `30000`

This setting will change the default maximum navigation time.

##### puppeteer

type: `Puppeteer`</br>
default: `puppeteer`|`puppeteer-core`|`puppeteer-firefox`

It's automatically detected based on your `dependencies` being supported [puppeteer](https://www.npmjs.com/package/puppeteer), [puppeteer-core](https://www.npmjs.com/package/puppeteer-core) or [puppeteer-firefox](https://www.npmjs.com/package/puppeteer-firefox).

### .createContext(options)

After initializing the browser, you can create a browser context which is equivalent to opening a tab:

```js
const browserless = browser.createContext({
  retry: 2
})
```

Every browser context is isolated. They won't share cookies/cache with other browser contexts. They also can contain specific options.

#### options

Any [browser.createBrowserContext#options](https://pptr.dev/next/api/puppeteer.browsercontextoptions) can be passed.

Additionally, you can setup:

##### retry

type: `number`</br>
default: `2`

The number of retries that can be performed before considering a navigation as failed.

### .browser()

It returns the internal [Browser](https://github.com/puppeteer/puppeteer/blob/v10.0.0/docs/api.md#class-browser) instance.

```js
const headlessBrowser = await browser.browser()

console.log('My headless browser PID is', headlessBrowser.process().pid)
```

### .respawn()

It will respawn the internal browser.

```js
const getPID = promise => (await promise).process().pid

console.log('Process PID:', await getPID(browser.browser()))

await browser.respawn()

console.log('Process PID:', await getPID(browser.browser()))
```

This method is an implementation detail, normally you don't need to call it.

### .close()

It will close the internal browser.

```js
const { onExit } = require('signal-exit')
// automatically teardown resources after
// `process.exit` is called
onExit(browser.close)
```

## Built-in

### .html(url, options)

It serializes the content from the target `url` into HTML.

```js
const html = await browserless.html('https://example.com')

console.log(html)
// => "<!DOCTYPE html><html><head>…"
```

#### options

See [browserless.goto](/#gotopage-options) to know all the options and values supported.

### .text(url, options)

It serializes the content from the target `url` into plain text.

```js
const text = await browserless.text('https://example.com')

console.log(text)
// => "Example Domain\nThis domain is for use in illustrative…"
```

#### options

See [browserless.goto](/#gotopage-options) to know all the options and values supported.

### .pdf(url, options)

It generates the PDF version of a website behind a `url`.

```js
const buffer = await browserless.pdf('https://example.com')

console.log(`PDF generated in ${buffer.byteLength()} bytes`)
```

#### options

This method uses the following options by default:

```js
{
  margin: '0.35cm',
  printBackground: true,
  scale: 0.65
}
```

See [browserless.goto](/#gotopage-options) to know all the options and values supported.

Also, any [page.pdf](https://github.com/puppeteer/puppeteer/blob/master/docs/api.md#pagepdfoptions) option is supported.

Additionally, you can setup:

##### margin

type: `string` | `string[]`</br>
default: `'0.35cm'`

It sets paper margins. All possible units are:

- `px` for pixel.
- `in` for inches.
- `cm` for centimeters.
- `mm` for millimeters.

You can pass an `object` object specifying each corner side of the paper:

```js
const buffer = await browserless.pdf(url.toString(), {
  margin: {
    top: '0.35cm',
    bottom: '0.35cm',
    left: '0.35cm',
    right: '0.35cm'
  }
})
```

Or, in case you pass a `string`, it will be used for all the sides:

```js
const buffer = await browserless.pdf(url.toString(), {
  margin: '0.35cm'
})
```

### .screenshot(url, options)

It takes a screenshot from the target `url`.

```js
const buffer = await browserless.screenshot('https://example.com')

console.log(`Screenshot taken in ${buffer.byteLength()} bytes`)
```

#### options

This method uses the following options by default:

```js
{
  device: 'macbook pro 13'
}
```

See [browserless.goto](/#gotopage-options) to know all the options and values supported.

Also, any [page.screenshot](https://github.com/puppeteer/puppeteer/blob/master/docs/api.md#pagescreenshotoptions) option is supported.

Additionally, you can setup:

##### codeScheme

type: `string`</br>
default: `'atom-dark'`

When this value is present and the response `'Content-Type'` header is `'json'`, it beautifies HTML markup using [Prism](https://prismjs.com).

![](https://i.imgur.com/uFfviX7.png)

The syntax highlight theme can be customized, during setup:

- A [prism-themes](https://github.com/PrismJS/prism-themes/tree/master/themes) identifier (e.g., `'dracula'`).
- A remote URL (e.g., `'https://unpkg.com/prism-theme-night-owl'`).

##### element

type: `string` </br>

Capture the DOM element matching the given [CSS selector](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors). It will wait for the element to appear in the page and to be visible.

##### overlay

type: `object`

After the screenshot has been taken, this option allows you to place the screenshot into a fancy overlay

![](https://i.imgur.com/GBa6Mj7.png)

You can configure the overlay by specifying:

- **browser**: It sets the browser image overlay to use, being `light` and `dark` supported values.
- **background**: It sets the background to use, being supported to pass:
  - An hexadecimal/rgb/rgba color code, eg. `#c1c1c1`.
  - A [CSS gradient](https://developer.mozilla.org/en-US/docs/Web/CSS/gradient), eg. `linear-gradient(225deg, #FF057C 0%, #8D0B93 50%, #321575 100%)`
  - An image URL, eg. `https://source.unsplash.com/random/1920x1080`.

```js
const buffer = await browserless.screenshot(url.toString(), {
  styles: ['.crisp-client, #cookies-policy { display: none; }'],
  overlay: {
    browser: 'dark',
    background:
      'linear-gradient(45deg, rgba(255,18,223,1) 0%, rgba(69,59,128,1) 66%, rgba(69,59,128,1) 100%)'
  }
})
```

### .destroyContext(options)

It will destroy the current browser context.

```js
const browserless = await browser.createContext({ retry: 0 })

const content = await browserless.html('https://example.com')

await browserless.destroyContext()
```

#### options

##### force

type: `string` </br>
default: `'force'`

When force is passed, it avoids recreating the context in case a browser action is being executed.

### .getDevice(options)

Used to set specific device descriptions, this method will be the device's settings.

```js
browserless.getDevice({ device: 'Macbook Pro 15' })

// => {
//   userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.89 Safari/537.36',
//   viewport: {
//     width: 1440,
//     height: 900,
//     deviceScaleFactor: 2,
//     isMobile: false,
//     hasTouch: false,
//     isLandscape: false
//   }
// }
```

It extends from [puppeteer.KnownDevices](https://pptr.dev/api/puppeteer.knowndevices/), adding some missing devices there.

#### options

##### device

type: `string` </br>

The device descriptor name. It's used to find the rest presets associated with it.

When [lossyDeviceName](#lossydevicename) is enabled, a fuzzy search rather than a strict search will be performed in order to maximize getting a result back.

##### viewport

type: `object` </br>

An extra viewport settings that will be merged with the device presets.

```js
browserless.getDevice({
  device: 'iPad',
  viewport: {
    isLandscape: true
  }
})
```

##### headers

type: `object` </br>

Extra headers that will be merged with the device presets.

```js
browserless.getDevice({
  device: 'iPad',
  headers: {
    'user-agent': 'googlebot'
  }
})
```

### .evaluate(fn, gotoOpts)

It exposes an interface for creating your own `evaluate` function, passing you the `page` and `response`.

The `fn` will receive `page` and `response` as arguments:

```js
const ping = browserless.evaluate((page, response) => ({
  statusCode: response.status(),
  url: response.url(),
  redirectUrls: response.request().redirectChain()
}))

await ping('https://example.com')
// {
//   "statusCode": 200,
//   "url": "https://example.com/",
//   "redirectUrls": []
// }
```

You don't need to close the page; It will be closed automatically.

Internally, the method performs a [browserless.[goto](#gotopage-options), making it possible to pass extra arguments as a second parameter:

```js
const serialize = browserless.evaluate(page => page.evaluate(() => document.body.innerText), {
  waitUntil: 'domcontentloaded'
})

await serialize('https://example.com')
// => '<!DOCTYPE html><html><div>…'
```

### .goto(page, options)

It performs a [page.goto](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options) with a lot of extra capabilities:

```js
const page = await browserless.page()
const { response, device } = await browserless.goto(page, { url: 'http://example.com' })
```

#### options

Any option passed here will bypass to [page.goto](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options).

Additionally, you can setup:

##### abortTypes

type: `array`</br>
default: `[]`

It sets the ability to abort requests based on the [ResourceType](https://github.com/puppeteer/puppeteer/blob/3db7d55d261b1e1fead7228a7ebf9825a0bcbe72/packages/puppeteer-core/src/common/HTTPRequest.ts#L68).

##### adblock

type: `boolean`</br>
default: `true`

It enabled the built-in [adblocker by](https://www.npmjs.com/package/@cliqz/adblocker) Cliqz](https://www.npmjs.com/package/@cliqz/adblocker) that aborts unnecessary third-party requests associated with ads services.

##### animations

type: `boolean`<br>
default: `false`

Disable CSS [animations](https://developer.mozilla.org/en-US/docs/Web/CSS/animation) and [transitions](https://developer.mozilla.org/en-US/docs/Web/CSS/transition), also it sets [prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) consequently.

##### click

type: `string` | `string[]`</br>

Click the DOM element matching the given [CSS selector](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors).

##### colorScheme

type: `string`</br>
default: `'no-preference'`

Sets [prefers-color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme) CSS media feature, used to detect if the user has requested the system use a `'light'` or `'dark'` color theme.

##### device

type: `string`</br>
default: `'macbook pro 13'`

It specifies the [device](#devices) descriptor used to retrieve `userAgent`` and `viewport`.

##### headers

type: `object`

An object containing additional HTTP headers to be sent with every request.

```js
const browserless = require('browserless')

const page = await browserless.page()
await browserless.goto(page, {
  url: 'http://example.com',
  headers: {
    'user-agent': 'googlebot',
    cookie: 'foo=bar; hello=world'
  }
})
```

This sets [`visibility: hidden`](https://stackoverflow.com/a/133064/64949) on the matched elements.

##### html

type: `string` </br>

In case you provide HTML markup, a [page.setContent](https://github.com/puppeteer/puppeteer/blob/v5.2.1/docs/api.md#pagesetcontenthtml-options) avoiding fetch the content from the target URL.

##### javascript

type: `boolean`<br>
default: `true`

When it's `false`, it disables JavaScript on the current page.

##### mediaType

type: `string`</br>
default: `'screen'`

Changes the CSS media type of the page using [page.emulateMediaType](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pageemulatemediamediatype).

##### modules

type: `string` | `string[]`</br>

Injects [&lt;script type="module"&gt;](https://v8.dev/features/modules) into the browser page.

It can accept:

- Absolute URLs (e.g., `'https://cdn.jsdelivr.net/npm/@microlink/mql@0.3.12/src/browser.js'`).
- Local file (e.g., `'local-file.js').
- Inline code (e.g., `"document.body.style.backgroundColor = 'red'"`).

```js
const buffer = await browserless.screenshot(url.toString(), {
  modules: [
    'https://cdn.jsdelivr.net/npm/@microlink/mql@0.3.12/src/browser.js',
    'local-file.js',
    "document.body.style.backgroundColor = 'red'"
  ]
})
```

##### onPageRequest

type:`function`

Associate a handler for every request in the page.

##### scripts

type: `string` | `string[]`</br>

Injects [&lt;script&gt;](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script) into the browser page.

It can accept:

- Absolute URLs (e.g., `'https://cdn.jsdelivr.net/npm/@microlink/mql@0.3.12/src/browser.js'`).
- Local file (e.g., `'local-file.js').
- Inline code (e.g., `"document.body.style.backgroundColor = 'red'"`).

```js
const buffer = await browserless.screenshot(url.toString(), {
  scripts: [
    'https://cdn.jsdelivr.net/npm/jquery@3.4.1/dist/jquery.min.js',
    'local-file.js',
    "document.body.style.backgroundColor = 'red'"
  ]
})
```

Prefer to use [modules](#modules) whenever possible.

##### scroll

type: `string`

Scroll to the DOM element matching the given [CSS selector](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors).

##### styles

type: `string` | `string[]`</br>

Injects [&lt;style&gt;](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/style) into the browser page.

It can accept:

- Absolute URLs (e.g., `'https://cdn.jsdelivr.net/npm/hack@0.8.1/dist/dark.css'`).
- Local file (e.g., `'local-file.css').
- Inline code (e.g., `"body { background: red; }"`).

```js
const buffer = await browserless.screenshot(url.toString(), {
  styles: [
    'https://cdn.jsdelivr.net/npm/hack@0.8.1/dist/dark.css',
    'local-file.css',
    'body { background: red; }'
  ]
})
```

##### timezone

type: `string`

It changes the [timezone](https://source.chromium.org/chromium/chromium/deps/icu.git/+/faee8bc70570192d82d2978a71e2a615788597d1:source/data/misc/metaZones.txt?originalUrl=https:%2F%2Fcs.chromium.org%2Fchromium%2Fsrc%2Fthird_party%2Ficu%2Fsource%2Fdata%2Fmisc%2FmetaZones.txt) of the page.

##### url

type: `string`

The target URL.

##### viewport

It will setup a custom viewport, using [page.setViewport](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagesetviewportviewport) method.

##### waitForSelector

type:`string`

Wait a quantity of time, selector or function using [page.waitForSelector](https://github.com/puppeteer/puppeteer/blob/main/docs/api.md#pagewaitforselectorselector-options).

##### waitForTimeout

type:`number`

Wait a quantity time in milliseconds.

##### waitUntil

type: `string` | `string[]`</br>
default: `'auto'`</br>
values: `'auto'` | `'load'` | `'domcontentloaded'` | `'networkidle0'` | `'networkidle2'`

When to consider navigation successful.

If you provide an array of event strings, navigation is considered to be successful after all events have been fired.

Events can be either:

- `'auto'`: A combination of `'load'` and `'networkidle2'` in a smart way to wait the minimum time necessary.
- `'load'`: Consider navigation to be finished when the load event is fired.
- `'domcontentloaded'`: Consider navigation to be finished when the DOMContentLoaded event is fired.
- `'networkidle0'`: Consider navigation to be finished when there are no more than 0 network connections for at least 500 ms.
- `'networkidle2'`: Consider navigation to be finished when there are no more than 2 network connections for at least 500 ms.

### .context()

It returns the [BrowserContext](https://github.com/puppeteer/puppeteer/blob/main/docs/api.md#class-browsercontext) associated with your instance.

```js
const browserContext = await browserless.context()

console.log({ isIncognito: browserContext.isIncognito() })
// => { isIncognito: true }
```

### .withPage(fn, [options])

It returns a higher-order function as convenient way to interact with a page:

```js
const getTitle = browserless.withPage((page, goto) => opts => {
  const result = await goto(page, opts)
  return page.title()
})
```

The function will be invoked in the following way:

```js
const title = getTitle({ url: 'https://example.com' })
```

#### fn

type: `function`

The function to be executed. It receives `page, goto` as arguments.

#### options

##### timeout

type: `number`</br>
default: `browserless.timeout`

This setting will change the default maximum navigation time.

### .page()

It returns a standalone [Page](https://github.com/puppeteer/puppeteer/blob/ddc59b247282774ccc53e3cc925efc30d4e25675/docs/api.md#class-page) associated with the current browser context.

```js
const page = await browserless.page()
await page.content()
// => '<html><head></head><body></body></html>'
```

## Extended

### function

The [`@browserless/function`](https://npm.im/@browserless/function) package provides an isolated VM scope to run arbitrary JavaScript code with runtime access to a browser page:

```js
const createFunction = require('@browserless/function')

const code = async ({ page }) => page.evaluate('jQuery.fn.jquery')

const version = createFunction(code)

const { isFulfilled, isRejected, value } = await version('https://jquery.com')

// => {
//   isFulfilled: true,
//   isRejected: false,
//   value: '1.13.1'
// }
```

#### options

Besides the following properties, any other argument provided will be available during the code execution.

##### vmOpts

The hosted code is also running inside a secure sandbox created via [vm2](https://npm.im/vm2).

##### gotoOpts

Any [goto#options](/#options-6) can be passed for tuning the internal URL resolution.

### lighthouse

The [`@browserless/lighthouse`](https://npm.im/@browserless/lighthouse) package provides you the setup for running [Lighthouse](https://developers.google.com/web/tools/lighthouse) reports backed by browserless.

```js
const createLighthouse = require('@browserless/lighthouse')
const createBrowser = require('browserless')
const { writeFile } = require('fs/promises')
const { onExit } = require('signal-exit')

const browser = createBrowser()
onExit(browser.close)

const lighthouse = createLighthouse(async teardown => {
  const browserless = await browser.createContext()
  teardown(() => browserless.destroyContext())
  return browserless
})

const report = await lighthouse('https://microlink.io')
await writeFile('report.json', JSON.stringify(report, null, 2))
```

The report will be generated for the provided URL. This extends the `lighthouse:default` settings. These settings are similar to the Google Chrome Audits reports on Developer Tools.

#### options

The [Lighthouse configuration](https://github.com/GoogleChrome/lighthouse/blob/main/docs/configuration.md) that will extend `'lighthouse:default'` settings:

```js
const report = await lighthouse(url, {
  onlyAudits: ['accessibility']
})
```

Also, you can extend from a different preset of settings:

```js
const report = await lighthouse(url, {
  preset: 'desktop',
  onlyAudits: ['accessibility']
})
```

Additionally, you can setup:

The lighthouse execution runs as a [worker thread](https://nodejs.org/api/worker_threads.html), any [worker#options](https://nodejs.org/api/worker_threads.html#new-workerfilename-options) are supported.

##### logLevel

type: `string`</br>
default: `'error'`</br>
values: `'silent'` | `'error'` | `'info'` | `'verbose'` </br>

The level of logging to enable.

##### output

type: `string` | `string[]`</br>
default: `'json'`</br>
values: `'json'` | `'csv'` | `'html'`

The type(s) of report output to be produced.

##### timeout

type: `number`</br>
default: `browserless.timeout`

This setting will change the default maximum navigation time.

### screencast

The [`@browserless/screencast`](https://npm.im/@browserless/screencast) package allows you to capture each frame of a browser navigation using puppeteer.

<div style="margin: auto;">
  <video poster="/static/screencast.png" loop="" controls="" src="https://github.com/microlinkhq/browserless/assets/2096101/a1753a2f-d4bb-47f1-a457-a0b73bb9d65d" style="width: 100%;border-radius: 4px;" autoplay=""></video>
</div>

This API is similar to [screenshots](#screenshoturl-options), but you have a more granular control over the frame and the output:

```js
const createScreencast = require('@browserless/screencast')
const createBrowser = require('browserless')

const browser = createBrowser()
const browserless = await browser.createContext()
const page = await browserless.page()

const screencast = createScreencast(page, { 
  maxWidth: 1280, 
  maxHeight: 800 
})

const frames = []
screencast.onFrame(data => frames.push(data))

screencast.start()
await browserless.goto(page, { url, waitForTimeout: 300 })
await screencast.stop()

console.log(frames)
```

Check a [full example](/blob/master/packages/screencast/examples/server.js) generating a GIF as output.

#### page

type: `object`

The [Page](https://pptr.dev/api/puppeteer.page) object.

#### options

See [Page.startScreencast](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-startScreencast) to know all the options and values supported.

## Packages

**browserless** is internally divided into multiple packages, this way you only use code you need.

| Package                                                                                               | Version                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [browserless](https://github.com/microlinkhq/browserless/tree/master/packages/browserless)            | [![npm](https://img.shields.io/npm/v/browserless.svg?style=flat-square)](https://www.npmjs.com/package/browserless)                         |
| [@browserless/benchmark](https://github.com/microlinkhq/browserless/tree/master/packages/benchmark)   | [![npm](https://img.shields.io/npm/v/@browserless/benchmark.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/benchmark)   |
| [@browserless/cli](https://github.com/microlinkhq/browserless/tree/master/packages/cli)               | [![npm](https://img.shields.io/npm/v/@browserless/cli.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/cli)               |
| [@browserless/devices](https://github.com/microlinkhq/browserless/tree/master/packages/devices)       | [![npm](https://img.shields.io/npm/v/@browserless/devices.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/devices)       |
| [@browserless/errors](https://github.com/microlinkhq/browserless/tree/master/packages/errors)         | [![npm](https://img.shields.io/npm/v/@browserless/errors.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/errors)         |
| [@browserless/examples](https://github.com/microlinkhq/browserless/tree/master/packages/examples)     | [![npm](https://img.shields.io/npm/v/@browserless/examples.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/examples)     |
| [@browserless/function](https://github.com/microlinkhq/browserless/tree/master/packages/function)     | [![npm](https://img.shields.io/npm/v/@browserless/function.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/function)     |
| [@browserless/goto](https://github.com/microlinkhq/browserless/tree/master/packages/goto)             | [![npm](https://img.shields.io/npm/v/@browserless/goto.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/goto)             |
| [@browserless/lighthouse](https://github.com/microlinkhq/browserless/tree/master/packages/lighthouse) | [![npm](https://img.shields.io/npm/v/@browserless/lighthouse.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/lighthouse) |
| [@browserless/pdf](https://github.com/microlinkhq/browserless/tree/master/packages/pdf)               | [![npm](https://img.shields.io/npm/v/@browserless/pdf.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/pdf)               |
| [@browserless/screencast](https://github.com/microlinkhq/browserless/tree/master/packages/screencast) | [![npm](https://img.shields.io/npm/v/@browserless/screencast.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/screencast) |
| [@browserless/screenshot](https://github.com/microlinkhq/browserless/tree/master/packages/screenshot) | [![npm](https://img.shields.io/npm/v/@browserless/screenshot.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/screenshot) |

## FAQ

**Q: Why use `browserless` over `puppeteer`?**

**browserless** does not replace puppeteer, it complements it. It's just a syntactic sugar layer over official Headless Chrome oriented for production scenarios.

**Q: Why do you block ads scripts by default?**

Headless navigation is expensive compared to just fetching the content from a website.

To speed up the process, we block ad scripts by default because most of them are resource-intensive.

**Q: My output is different from the expected**

Probably **browserless** was too smart and it blocked a request that you need.

You can active debug mode using `DEBUG=browserless` environment variable in order to see what is happening behind the code:

Consider opening an [issue](https://github.com/microlinkhq/browserless/issues/new) with the debug trace.

**Q: I want to use `browserless` with my AWS Lambda like project**

Yes, check [chrome-aws-lambda](https://github.com/alixaxel/chrome-aws-lambda) to setup AWS Lambda with a binary compatible.

## License

**browserless** © [Microlink](https://microlink.io), released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Microlink](https://microlink.io) with help from [contributors](https://github.com/microlinkhq/browserless/contributors).

The [logo](https://thenounproject.com/term/browser/288309/) has been designed by [xinh studio](https://xinh.studio).

> [microlink.io](https://microlink.io) · GitHub [microlinkhq](https://github.com/microlinkhq) · Twitter [@microlinkhq](https://twitter.com/microlinkhq)
