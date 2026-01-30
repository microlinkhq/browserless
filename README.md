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

> The headless Chrome/Chromium driver on top of [Puppeteer](https://github.com/GoogleChrome/puppeteer).
- [Highlights](#highlights)
- [Installation](#installation)
- [Usage](#usage)
- [The cloud API solution](#the-cloud-api-solution)
- [CLI](#cli)
- [Initializing a browser](#initializing-a-browser)
  - [.constructor(options)](#constructoroptions)
  - [.createContext(options)](#createcontextoptions)
  - [.browser()](#browser)
  - [.respawn()](#respawn)
  - [.close()](#close)
- [Built-in](#built-in)
  - [.html(url, options)](#htmlurl-options)
  - [.text(url, options)](#texturl-options)
  - [.pdf(url, options)](#pdfurl-options)
  - [.screenshot(url, options)](#screenshoturl-options)
  - [.destroyContext(options)](#destroycontextoptions)
  - [.getDevice(options)](#getdeviceoptions)
  - [.evaluate(fn, gotoOpts)](#evaluatefn-gotoopts)
  - [.goto(page, options)](#gotopage-options)
  - [.context()](#context)
  - [.withPage(fn, \[options\])](#withpagefn-options)
  - [.page()](#page)
- [Extended](#extended)
  - [function](#function)
  - [lighthouse](#lighthouse)
  - [screencast](#screencast)
- [Packages](#packages)
- [FAQ](#faq)
- [License](#license)

---

## Highlights

- Compatible with Puppeteer API ([text](#texturl-options), [screenshot](#screenshoturl-options), [html](#htmlurl-options), [pdf](#pdfurl-options)).
- Built-in [adblocker](#adblock) for canceling unnecessary requests.
- Shell interaction via [Browserless CLI](#cli).
- Easy [Google Lighthouse](#lighthouse) integration.
- Automatic retry & error handling.
- Sensible good defaults.

## Installation

You can install it via npm:

```bash
npm install browserless puppeteer --save
```

**Browserless** runs on top of [Puppeteer](https://github.com/GoogleChrome/puppeteer), so you need that installed to get started.

You can choose between [`puppeteer`](https://www.npmjs.com/package/puppeteer) and [`puppeteer-core`](https://www.npmjs.com/package/puppeteer-core) depending on your use case.

## Usage

Here is a complete example showcasing some **Browserless** capabilities:

```js
const createBrowser = require('browserless')
const termImg = require('term-img')

// First, create a browserless factory
// This is similar to opening a browser for the first time
const browser = createBrowser()

// Browser contexts are like browser tabs
// You can create as many as your resources can support
// Cookies/caches are limited to their respective browser contexts, just like browser tabs
const browserless = await browser.createContext()

// Perform your required browser actions.
// e.g., taking screenshots or fetching HTML markup
const buffer = await browserless.screenshot('http://example.com', {
  device: 'iPhone 6'
})

console.log(termImg(buffer))

// After your task is done, destroy your browser context
await browserless.destroyContext()

// At the end, gracefully shutdown the browser process
await browser.close()
```

As you can see, **Browserless** uses a single browser process, allowing you to create and destroy multiple browser contexts within that same process.

If you're already using Puppeteer in your project, you can layer **Browserless** on top simply by installing it.

You can also include additional **Browserless** [packages](#packages) to suit your specific needs, all of which work well with Puppeteer.

## The cloud API solution

If you don’t want to manage that infrastructure, you can use the fully managed
[Microlink API](https://microlink.io/docs/api/getting-started/overview).

It covers every **browserless** use case but automatically handles proxy rotation, paywalls, bot detection, and restricted platforms such as major social networks, while scaling on demand.

Pricing is pay-as-you-go and [starts for free](https://microlink.io/#pricing).

## CLI

Using the **Browserless** command-line tool, you can interact with Browserless through a terminal window, or use it as part of an automated process:

<div style="margin: auto;">
  <video poster="/static/cli.png" loop="" controls="" src="https://github.com/microlinkhq/browserless/assets/2096101/5200b2c5-d930-40e7-b128-6d23a6974c28" style="width: 100%;border-radius: 4px;" autoplay=""></video>
</div>

Install [`@browserless/cli`](https://npm.im/@browserless/cli) globally using your favorite package manager:

```
npm install -g @browserless/cli
```

Then run `browserless` in your terminal to see the list of available commands.

## Initializing a browser

Initializing **Browserless** creates a headless browser instance.

```js
const createBrowser = require('browserless')

const browser = createBrowser({
  timeout: 25000,
  lossyDeviceName: true,
  ignoreHTTPSErrors: true
})
```

This instance provides several high-level methods. 

For example:

```js
// Call `createContext` to create a browser tab
const browserless = await browser.createContext({ retry: 2 })

const buffer = await browserless.screenshot('https://example.com')

// Call `destroyContext` to close the browser tab.
await browserless.destroyContext()
```

The browser keeps running until you explicitly close it:

```js
// At the end, gracefully shutdown the browser process
await browser.close()
```

### .constructor(options)

The `createBrowser` method supports [puppeteer.launch#options](https://github.com/puppeteer/puppeteer/blob/main/docs/api/puppeteer.launchoptions.md).


**Browserless** provides additional options for creating a browser instance:

##### defaultDevice

Sets your browser viewport to that of the specified device:

type: `string`<br/>
default: `'Macbook Pro 13'`



##### lossyDeviceName

type: `boolean`<br/>
default: `false`

Allows for a margin of error when setting the device name.

```js

// Initialize browser instance
const browser = require('browserless')({ lossyDeviceName: true });

(async () => {
    // Create context/tab
    const tabInstance = await browser.createContext();

    // Even if the device name is misspelled, the property will default to 'MacBook Pro'
    console.log(tabInstance.getDevice({ device: 'MacBook Pro' }))
    console.log(tabInstance.getDevice({ device: 'macbook pro 13' }))
    console.log(tabInstance.getDevice({ device: 'MACBOOK PRO 13' }))
    console.log(tabInstance.getDevice({ device: 'macbook pro' }))
    console.log(tabInstance.getDevice({ device: 'macboo pro' }))
})()
```

The provided name will be resolved to closest matching device.

This comes in handy in situations where the device name is set by a third-party.

##### mode

type: `string`<br/>
default: `launch`<br/>
values: `'launch'` | `'connect'`

Specifies if the browser instance should be spawned using [puppeteer.launch](https://github.com/puppeteer/puppeteer/blob/v5.5.0/docs/api.md#puppeteerlaunchoptions) or [puppeteer.connect](https://github.com/puppeteer/puppeteer/blob/v5.5.0/docs/api.md#puppeteerconnectoptions).

##### timeout

type: `number`<br/>
default: `30000`

Changes the default maximum navigation time.

##### puppeteer

type: `Puppeteer`<br/>
default: `puppeteer`|`puppeteer-core`|`puppeteer-firefox`

By default, it automatically detects which libary is installed (thus either [puppeteer](https://www.npmjs.com/package/puppeteer) or [puppeteer-core](https://www.npmjs.com/package/puppeteer-core) based on your installed dependecies.

### .createContext(options)

After initializing the browser, you can create a browser context which is equivalent to opening a tab:

```js
const browserless = await browser.createContext({
  retry: 2
})
```

Each browser context is isolated, thus cookies/cache stay within its corresponding browser contexts, just like browser tabs. Each context can be initialized with its own set of options.

#### options

All of Puppeteer's [browser.createBrowserContext#options](https://pptr.dev/next/api/puppeteer.browsercontextoptions) are supported.

Browserless provides additional browser context options:

##### retry

type: `number`<br/>
default: `2`

The number of retries that can be performed before considering a navigation as failed.

### .browser()

Returns the internal [Browser](https://github.com/puppeteer/puppeteer/blob/v10.0.0/docs/api.md#class-browser) instance.

```js
const headlessBrowser = await browser.browser()

console.log('My headless browser PID is', headlessBrowser.process().pid)
console.log('My headless browser version is', await headlessBrowser.version())
```

### .respawn()

Respawns the internal browser.

```js
const getPID = promise => (await promise).process().pid

console.log('Process PID:', await getPID(browser.browser()))

await browser.respawn()

console.log('Process PID:', await getPID(browser.browser()))
```

This method is an implementation detail, normally you don't need to call it.

### .close()

Closes the internal browser.

```js
const { onExit } = require('signal-exit')
// automatically teardown resources after
// `process.exit` is called
onExit(browser.close)
```

## Built-in

### .html(url, options)

Serializes the content of a target `url` into HTML.

```js
const html = await browserless.html('https://example.com')

console.log(html)
// => "<!DOCTYPE html><html><head>…"
```

#### options

See [browserless.goto](/#gotopage-options) for all the options and supported values.

### .text(url, options)

Serializes the content from the target `url` into plain text.

```js
const text = await browserless.text('https://example.com')

console.log(text)
// => "Example Domain\nThis domain is for use in illustrative…"
```

#### options

See [browserless.goto](/#gotopage-options) for all the options and supported values.

### .pdf(url, options)

Generates the PDF version of a website behind a `url`.

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

See [browserless.goto](/#gotopage-options) for all the options and supported values.

Also, all of Puppeteer's [page.pdf](https://github.com/puppeteer/puppeteer/blob/master/docs/api.md#pagepdfoptions) options are supported.

Additionally, you can setup:

##### margin

type: `string` | `string[]`<br/>
default: `'0.35cm'`

Sets screen margins. Supported units include:

- `px` for pixel.
- `in` for inches.
- `cm` for centimeters.
- `mm` for millimeters.

You can set the margin properties by passing them in as an `object`:

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

In case a single margin value is provided, this will be used for all sides:

```js
const buffer = await browserless.pdf(url.toString(), {
  margin: '0.35cm'
})
```

### .screenshot(url, options)

Generates screenshots based on a specified `url`.

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

See [browserless.goto](/#gotopage-options) for all the options and supported values.

Also, all of Puppeteer's [page.screenshot](https://github.com/puppeteer/puppeteer/blob/master/docs/api.md#pagescreenshotoptions) options are supported.

Additionally, **Browserless** provides the following options:

##### codeScheme

type: `string`<br/>
default: `'atom-dark'`

Whenever the incoming response `'Content-Type'` is set to `'json'`, the JSON payload will be presented as a formatted JSON string, beautified using the provided `codeScheme` theme or by default `atom-dark`. 

The color schemes is based on the [Prism library](https://prismjs.com).

![](https://i.imgur.com/uFfviX7.png)

The [Prism repository](https://github.com/PrismJS/prism-themes/tree/master?tab=readme-ov-file#available-themes) offers a wide range of themes to choose from as well as a [CDN option](https://unpkg.com/browse/prismjs@1.29.0/themes).

##### element

type: `string` <br/>

Returns the first instance of a matching DOM element based on a [CSS selector](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors). This operation remains unresolved until the element is displayed on screen or the specified maximum [timeout](#timeout) is reached.

##### overlay

type: `object`

Once the screenshot has been taken, this option allows you to apply an overlay (backdrop).

![Overlay example](/static/ml-landing.jpeg)

You can configure the overlay by specifying the following:

- **browser**: Specifies the color of the browser stencil to use, thus either `light` or `dark` for light and dark mode respectively.
- **background**: Specifies the background to use. A number of value types are supported:
  - Hexadecimal/RGB/RGBA color codes, eg. `#c1c1c1`.
  - [CSS gradients](https://developer.mozilla.org/en-US/docs/Web/CSS/gradient), eg. `linear-gradient(225deg, #FF057C 0%, #8D0B93 50%, #321575 100%)`
  - Image URLs, eg. `https://source.unsplash.com/random/1920x1080`.

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

Destroys the current browser context.

```js
const browserless = await browser.createContext({ retry: 0 })

const content = await browserless.html('https://example.com')

await browserless.destroyContext()
```

#### options

##### force

type: `string` <br/>
default: `'force'`

When `force` is set, it prevents the recreation of the context in case a browser action is being executed.

### .getDevice(options)

Used to set a specific device type, this method sets the device properties.

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

This method extends the [Puppeteer.KnownDevices](https://pptr.dev/api/puppeteer.knowndevices/) list by adding some missing devices.

#### options

##### device

type: `string` <br/>

The device descriptor name. It's used to fetch preset values associated with a device.

When [lossyDeviceName](#lossydevicename) is enabled, a fuzzy search is performed instead of a strict search to maximize the likelihood of finding a match.

##### viewport

type: `object` </br>

Sets extra viewport settings. These settings will be merged with the preset settings.

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

It exposes an interface for creating your own `evaluate` function, providing access to `page` and `response`.

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

You don't need to close the page, it will be closed automatically.

Internally, the method performs a [browserless.goto](#gotopage-options), making it possible to pass extra arguments as a second parameter:

```js
const serialize = browserless.evaluate(page => page.evaluate(() => document.body.innerText), {
  waitUntil: 'domcontentloaded'
})

await serialize('https://example.com')
// => '<!DOCTYPE html><html><div>…'
```

### .goto(page, options)

Performs a [page.goto](https://github.com/puppeteer/puppeteer/blob/main/docs/api/puppeteer.gotooptions.md) with a lot of extra capabilities:

```js
const page = await browserless.page()
const { response, device } = await browserless.goto(page, { url: 'http://example.com' })
```

#### options

Any option passed here will bypass to [page.goto](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options).

Additionally, you can setup:

##### abortTypes

type: `array`<br/>
default: `[]`

Sets the ability to abort requests based on the [ResourceType](https://github.com/puppeteer/puppeteer/blob/3db7d55d261b1e1fead7228a7ebf9825a0bcbe72/packages/puppeteer-core/src/common/HTTPRequest.ts#L68).

##### adblock

type: `boolean`<br/>
default: `true`

Enables the built-in [adblocker by](https://www.npmjs.com/package/@cliqz/adblocker) [Cliqz](https://www.npmjs.com/package/@cliqz/adblocker) that aborts unnecessary third-party requests associated with ads services.

##### animations

type: `boolean`<br/>
default: `false`

Disables CSS [animations](https://developer.mozilla.org/en-US/docs/Web/CSS/animation) and [transitions](https://developer.mozilla.org/en-US/docs/Web/CSS/transition), also it sets [prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) consequently.

##### authenticate

type: `object`<br/>

It will be passed down to [page.authenticate](https://pptr.dev/api/puppeteer.page.authenticate).

##### click

type: `string` | `string[]`<br/>

Clicks the DOM element matching the [CSS selector](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors).

##### colorScheme

type: `string`<br/>
default: `'no-preference'`

Sets [prefers-color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme) CSS media feature, used to detect if the user has requested the system use a `'light'` or `'dark'` color theme.

##### device

type: `string`<br/>
default: `'macbook pro 13'`

It specifies the [device](#devices) descriptor used to retrieve `userAgent` and `viewport`.

##### headers

type: `object`

An object containing additional HTTP headers to send with every request.

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

type: `string` <br/>

In case you provide HTML markup, a [page.setContent](https://github.com/puppeteer/puppeteer/blob/v5.2.1/docs/api.md#pagesetcontenthtml-options) avoiding fetch the content from the target URL.

##### javascript

type: `boolean`<br/>
default: `true`

When it's `false`, it disables JavaScript on the current page.

##### mediaType

type: `string`<br/>
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

Associates a handler for every request in the page.

##### scripts

type: `string` | `string[]`</br>

Injects [&lt;script&gt;](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script) into the browser page.

It can accept:

- Absolute URLs (e.g., `'https://cdn.jsdelivr.net/npm/@microlink/mql@0.3.12/src/browser.js'`).
- Local files (e.g., `'local-file.js').
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

Use [modules](#modules) whenever possible.

##### scroll

type: `string`

Scrolls to the DOM element matching the [CSS selector](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors).

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

Changes the [timezone](https://source.chromium.org/chromium/chromium/deps/icu.git/+/faee8bc70570192d82d2978a71e2a615788597d1:source/data/misc/metaZones.txt?originalUrl=https:%2F%2Fcs.chromium.org%2Fchromium%2Fsrc%2Fthird_party%2Ficu%2Fsource%2Fdata%2Fmisc%2FmetaZones.txt) of the page.

##### url

type: `string`

The target URL.

##### viewport

Setups a custom viewport, using [page.setViewport](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagesetviewportviewport) method.

##### waitForSelector

type:`string`

Waits a quantity of time, selector or function using [page.waitForSelector](https://github.com/puppeteer/puppeteer/blob/main/docs/api.md#pagewaitforselectorselector-options).

##### waitForTimeout

type:`number`

Waits a quantity time in milliseconds.

##### waitUntil

type: `string` | `string[]`<br/>
default: `'auto'`<br/>
values: `'auto'` | `'load'` | `'domcontentloaded'` | `'networkidle0'` | `'networkidle2'`

Determines when the navigation is considered successful.

If an array of event strings is provided, navigation is considered successful once all events have fired.

Events can be either:

- `'auto'`: A combination of `'load'` and `'networkidle2'` in a smart way to wait the minimum time necessary.
- `'load'`: Consider navigation to be finished when the load event is fired.
- `'domcontentloaded'`: Consider navigation to be finished when the DOMContentLoaded event is fired.
- `'networkidle0'`: Consider navigation to be finished when there are no more than 0 network connections for at least 500 ms.
- `'networkidle2'`: Consider navigation to be finished when there are no more than 2 network connections for at least 500 ms.

### .context()

Returns the [BrowserContext](https://github.com/puppeteer/puppeteer/blob/main/docs/api.md#class-browsercontext) associated with your instance.

```js
const browserContext = await browserless.context()

console.log(browserContext.id)
// => 'D2CD28FDECB1859772B9C5919E563C84'
```

### .withPage(fn, [options])

Returns a higher-order function as convenient way to interact with a page:

```js
const getTitle = browserless.withPage((page, goto) => async opts => {
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

Returns a standalone [Page](https://github.com/puppeteer/puppeteer/blob/ddc59b247282774ccc53e3cc925efc30d4e25675/docs/api.md#class-page) associated with the current browser context.

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

type: `string`<br/>
default: `'error'`<br/>
values: `'silent'` | `'error'` | `'info'` | `'verbose'` </br>

The level of logging to enable.

##### output

type: `string` | `string[]`<br/>
default: `'json'`<br/>
values: `'json'` | `'csv'` | `'html'`

The type(s) of report output to be produced.

##### timeout

type: `number`</br>
default: `browserless.timeout`

Changes the default maximum navigation time.

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

See a [full example](/blob/master/packages/screencast/examples/server.js) that generates a GIF.

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

**browserless** does not replace Puppeteer; it complements it. It acts as a syntactic sugar layer over official Headless Chrome, optimized for production scenarios.

**Q: Is there a hosted cloud solution?**

Yes. If you don't want to manage the infrastructure of headless browsers, proxies, and antibot workarounds, use the [Microlink API](https://microlink.io) we've built.

It scales on demand, and pricing [starts for free](https://microlink.io/#pricing).

**Q: Why do you block ads scripts by default?**

Headless navigation is expensive compared to just fetching the content from a website.

To speed up the process, we block ad scripts by default because most of them are resource-intensive.

**Q: My output is different from the expected**

**Browserless** might have been too smart and blocked a request that you need.

You can activate debug mode using `DEBUG=browserless` environment variable in order to see what is happening under the hood:

Consider opening an [issue](https://github.com/microlinkhq/browserless/issues/new) with the debug trace.

**Q: I want to use `browserless` with my AWS Lambda like project**

Yes, check [chrome-aws-lambda](https://github.com/alixaxel/chrome-aws-lambda) to setup AWS Lambda with a binary compatible.

## License

**browserless** © [Microlink](https://microlink.io), released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Microlink](https://microlink.io) with help from [contributors](https://github.com/microlinkhq/browserless/contributors).

The [logo](https://thenounproject.com/term/browser/288309/) has been designed by [xinh studio](https://xinh.studio).

> [microlink.io](https://microlink.io) · GitHub [microlinkhq](https://github.com/microlinkhq) · X [@microlinkhq](https://x.com/microlinkhq)
