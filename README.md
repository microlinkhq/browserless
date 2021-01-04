<h1 align="center">
  <img style="width: 500px; margin:3rem 0 1.5rem;" src="/static/logo-banner.png" alt="browserless">
  <br>
</h1>

![Last version](https://img.shields.io/github/tag/microlinkhq/browserless.svg?style=flat-square)
[![Build Status](https://img.shields.io/travis/microlinkhq/browserless/master.svg?style=flat-square)](https://travis-ci.com/microlinkhq/browserless)
[![NPM Status](https://img.shields.io/npm/dm/browserless.svg?style=flat-square)](https://www.npmjs.org/package/browserless)

> The Headless Chrom[e|ium] driver for Node.js.

**browserless** is a headless Chrome/Chromium driver built on top of [puppeteer](https://github.com/GoogleChrome/puppeteer), created to handle resources efficiently and satisfy the most desired production scenarios.

## Highlights

- Puppeteer-like API for common tasks ([text](texturl-options), [screenshot](#screenshoturl-options), [html](#htmlurl-options), [pdf](#pdfurl-options)).
- Automatic 3rd party requests cancellation via [adblocker](#gotopage-options).
- Simple [Google Lighthouse](#lighthouse) integration.
- Configurable [pooling](#pool-of-instances) support.

## Installation

You can install it via npm:
 
```bash
$ npm install browserless puppeteer --save
```

**browserless** has a puppeteer-like API and it uses puppeteer under the hood. 

You can use it with [`puppeteer`](https://www.npmjs.com/package/puppeteer), [`puppeteer-core`](https://www.npmjs.com/package/puppeteer-core) or [`puppeteer-firefox`](https://www.npmjs.com/package/puppeteer-firefox), interchangeably.

## Usage

**browserless** has the same API is than [puppeteer](https://github.com/GoogleChrome/puppeteer):

```js
const browserless = require('browserless')()
const termImg = require('term-img')

async function main () {
  const buffer = await browserless.screenshot('http://example.com', {
    device: 'iPhone 6'
  })

  console.log(termImg(buffer))
}
```

If you're already using puppeteer, you can upgrade to use **browserless** instead almost with no effort.


Additionally, you can use some specific [packages](#packages) in your codebase, interacting with them from puppeteer.

## Basic

All methods follow the same interface:

- `<url>`: The target URL. It's required.
- `[options]`: Specific settings for the method. It's optional.

The methods returns a Promise or a Node.js callback if pass an additional function as the last parameter.

### .constructor(options)

It creates the `browser` instance, using [puppeter.launch](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#puppeteerlaunchoptions) method.

```js
// Creating a simple instance
const browserless = require('browserless')()
```

or passing specific launchers options:

```js
// Creating an instance for running it at AWS Lambda
const browserless = require('browserless')({
  ignoreHTTPSErrors: true,
  args: ['--disable-gpu', '--single-process', '--no-zygote', '--no-sandbox', '--hide-scrollbars']
})
```

#### options

See [puppeteer.launch#options](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#puppeteerlaunchoptions).

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

##### timeout

type: `number`</br>
default: `30000`

This setting will change the default maximum navigation time.

##### retry

type: `number`</br>
default: `5`

The number of retries that can be performed before considering a navigation as failed.

##### proxy

type: `string`</br>
default: `undefined`

It will setup a proxy to be used to communicate between the browser and the target URL.

##### puppeteer

type: `Puppeteer`</br>
default: `puppeteer`|`puppeteer-core`|`puppeteer-firefox`

It's automatically detected based on your `dependencies` being supported [puppeteer](https://www.npmjs.com/package/puppeteer), [puppeteer-core](https://www.npmjs.com/package/puppeteer-core) or [puppeteer-firefox](https://www.npmjs.com/package/puppeteer-firefox).

Alternatively, you can pass it.

##### incognito

type: `boolean`</br>
default: `false`

Every time a new page is created, it will be an incognito page.

An incognito page will not share cookies/cache with other browser pages.

### .html(url, options)

It serializes the content from the target `url` into HTML.

```js
const browserless = require('browserless')

;(async () => {
  const url = 'https://example.com'
  const html = await browserless.html(url)
  console.log(html)
})()
```

#### options

See [browserless.goto](/#gotopage-options) to know all the options and values supported.

### .text(url, options)

It serializes the content from the target `url` into plain text.

```js
const browserless = require('browserless')

;(async () => {
  const url = 'https://example.com'
  const text = await browserless.text(url)
  console.log(text)
})()
```

#### options

See [browserless.goto](/#gotopage-options) to know all the options and values supported.

### .pdf(url, options)

It generates the PDF version of a website behind an `url`.

```js
const browserless = require('browserless')

;(async () => {
  const url = 'https://example.com'
  const buffer = await browserless.pdf(url)
  console.log('PDF generated!')
})()
```

#### options

This method use the following options by default:

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

You can pass an `object` object specifing each corner side of the paper:

```js
;(async () => {
  const buffer = await browserless.pdf(url.toString(), {
    margin: {
      top: '0.35cm',
      bottom: '0.35cm',
      left: '0.35cm',
      right: '0.35cm'
    }
  })
})()
```

Or, in case you pass an `string`, it will be used for all the sides:

```js
;(async () => {
  const buffer = await browserless.pdf(url.toString(), {
    margin: '0.35cm'
  })
})()
```

### .screenshot(url, options)

It takes a screenshot from the target `url`.

```js
const browserless = require('browserless')

;(async () => {
  const url = 'https://example.com'
  const buffer = await browserless.screenshot(url)
  console.log('Screenshot taken!')
})()
```

#### options

This method use the following options by default:

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

The syntax highlight theme can be customized, being possible to setup:

- A [prism-themes](https://github.com/PrismJS/prism-themes/tree/master/themes) identifier (e.g., `'dracula'`).
- A remote URL (e.g., `'https://unpkg.com/prism-theme-night-owl'`).

##### element

type: `string` </br>

Capture the DOM element matching the given [CSS selector](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors). It will wait for the element to appear in the page and to be visible.

##### overlay

type: `object`

After the screenshot has been taken, this option allows you to place the screenshot into a fancy overlay

![](https://i.imgur.com/GBa6Mj7.png)

You can configure the overlay specifying:

- **browser**: It sets the browser image overlay to use, being `light` and `dark` supported values.
- **background**: It sets the background to use, being supported to pass:
  - An hexadecimal/rgb/rgba color code, eg. `#c1c1c1`.
  - A [CSS gradient](https://developer.mozilla.org/en-US/docs/Web/CSS/gradient), eg. `linear-gradient(225deg, #FF057C 0%, #8D0B93 50%, #321575 100%)`
  - An image url, eg. `https://source.unsplash.com/random/1920x1080`.

```js
;(async () => {
  const buffer = await browserless.screenshot(url.toString(), {
    hide: ['.crisp-client', '#cookies-policy'],
    overlay: {
      browser: 'dark',
      background:
        'linear-gradient(45deg, rgba(255,18,223,1) 0%, rgba(69,59,128,1) 66%, rgba(69,59,128,1) 100%)'
    }
  })
})()
```

### .devices

It has all the devices presets available, being possible to load viewport and user agents settings based on a device descriptor.

These devices are used for emulation purposes. It extends from [puppeteer.devices](https://github.com/puppeteer/puppeteer/blob/master/docs/api.md#puppeteerdevices).

#### .getDevice({ device, viewport, headers })

Get a specific device descriptor settings by descriptor name.

It doesn't matter if device name is lower/upper case.

```js
const browserless = require('browserless')

browserless.getDevice({ device: 'Macbook Pro 15' })
// {
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

## Advanced

The following methods are exposed to be used in scenarios where you need more granularity control and less magic.

### .browser

It returns the internal [browser](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#class-browser) instance used as singleton.

```js
const browserless = require('browserless')

;(async () => {
  const browserInstance = await browserless.browser
})()
```

### .evaluate(fn, gotoOpts)

It exposes an interface for creating your own evaluate function, passing you the `page` and `response`.

The `fn` will receive `page` and `response` as arguments:

```js
const browserless = require('browserless')()

const getUrlInfo = browserless.evaluate((page, response) => ({
  statusCode: response.status(),
  url: response.url(),
  redirectUrls: response.request().redirectChain()
}))

;(async () => {
  const url = 'https://example.com'
  const info = await getUrlInfo(url)

  console.log(info)
  // {
  //   "statusCode": 200,
  //   "url": "https://example.com/",
  //   "redirectUrls": []
  // }
})()
```

Note you don't need to close the page; It will be done under the hood.

Internally, the method performs a [browserless.goto](#gotopage-options), being possible to pass extra arguments as second parameter:

```js
const browserless = require('browserless')()

const getText = browserless.evaluate(page => page.evaluate(() => document.body.innerText), {
  waitUntil: 'domcontentloaded'
})

;(async () => {
  const url = 'https://example.com'
  const text = await getText(url)

  console.log(text)
})()
```

### .goto(page, options)

It performs a smart [page.goto](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options), using a builtin [adblocker by Cliqz](https://www.npmjs.com/package/@cliqz/adblocker).

```js
const browserless = require('browserless')

;(async () => {
  const page = await browserless.page()
  const { response, device } = await browserless.goto(page, { url: 'http://example.com' })
})()
```

#### options

Any option passed here will bypass to [page.goto](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options).

Additionally, you can setup:

##### adblock

type: `boolean`</br>
default: `true`

It will be abort requests detected as ads.

##### animations

type: `boolean`<br>
default: `false`

Disable CSS [animations](https://developer.mozilla.org/en-US/docs/Web/CSS/animation) and [transitions](https://developer.mozilla.org/en-US/docs/Web/CSS/transition), also it sets [prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) consequently.

##### click

type: `string` | `string[]`</br>

Click the DOM element matching the given [CSS selector](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors).

##### device

type: `string`</br>
default: `'macbook pro 13'`

It specifies the [device](#devices) descriptor to use in order to retrieve `userAgent` and `viewport`.

##### evasions

type: `string[]`</br>
default: `require('@browserless/goto').evasions`

It makes your Headless undetectable, preventing to being blocked.

These techniques are used by [antibot](https://news.ycombinator.com/item?id=20479015) systems to check if you are a real browser and block any kind of automated access

Evasions techniques implemented are:

| Evasion                                                                                                                            | Description                                                                                                    |
|------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| [chromeRuntime](https://github.com/microlinkhq/browserless/blob/master/packages/goto/src/evasions/chrome-runtime.js)               | It creates the `window.chrome` object associated to any Chrome browser                                         |
| [consoleDebug](https://github.com/microlinkhq/browserless/blob/master/packages/goto/src/evasions/console-debug.js)                 | Ensure [`console.debug`](https://developer.mozilla.org/en-US/docs/Web/API/Console/debug#:~:text=The%20console%20method%20debug(),is%20available%20in%20Web%20Workers.) exists. |
| [errorStackTrace](https://github.com/microlinkhq/browserless/blob/master/packages/goto/src/evasions/error-stack-trace.js)          | Prevent detect Puppeteer via variable name. |
| [mediaCodecs](https://github.com/microlinkhq/browserless/blob/master/packages/goto/src/evasions/media-codecs.js)                   | Ensure media codedcs are defined. |
| [navigatorPermissions](https://github.com/microlinkhq/browserless/blob/master/packages/goto/src/evasions/navigator-permissions.js) | Mock over [`Notification.permissions`](https://developer.mozilla.org/en-US/docs/Web/API/Notification/permission). |
| [navigatorPlugins](https://github.com/microlinkhq/browserless/blob/master/packages/goto/src/evasions/navigator-plugins.js)         | Ensure your browser has [`NavigatorPlugins`](https://developer.mozilla.org/en-US/docs/Web/API/NavigatorPlugins) defined. |
| [navigatorWebdriver](https://github.com/microlinkhq/browserless/blob/master/packages/goto/src/evasions/navigator-webdriver.js)     | Ensure [`Navigator.webdriver`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/webdriver) exists. |
| [randomizeUserAgent](https://github.com/microlinkhq/browserless/blob/master/packages/goto/src/evasions/randomize-user-agent.js)    | Use a different [`User-Agent`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/User-Agent) every time. |
| [webglVendor](https://github.com/microlinkhq/browserless/blob/master/packages/goto/src/evasions/webgl-vendor.js)                   | Ensure [`WebGLRenderingContext`](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext) & [`WebGL2RenderingContext`](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext) returns browser-like information. |

All the evasions techinques are enabled by default.

```js
const evasions = require('@browserless/goto').evasions.filter(
  evasion => evasion !== 'randomizeUserAgent'
)

const browserless = require('browserless')({ evasions })
```

![](/static/evasions.png)

##### headers

type: `object`

An object containing additional HTTP headers to be sent with every request.

```js
const browserless = require('browserless')

;(async () => {
  const page = await browserless.page()
  await browserless.goto(page, {
    url: 'http://example.com',
    headers: {
      'user-agent': 'googlebot',
      cookie: 'foo=bar; hello=world'
    }
  })
})()
```

##### hide

type: `string` | `string[]`</br>

Hide DOM elements matching the given [CSS selectors](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors).

```js
;(async () => {
  const buffer = await browserless.screenshot(url.toString(), {
    hide: ['.crisp-client', '#cookies-policy']
  })
})()
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
;(async () => {
  const buffer = await browserless.screenshot(url.toString(), {
    modules: [
      'https://cdn.jsdelivr.net/npm/@microlink/mql@0.3.12/src/browser.js',
      'local-file.js',
      "document.body.style.backgroundColor = 'red'"
    ]
  })
})()
```

##### remove

type: `string` | `string[]`</br>

Remove DOM elements matching the given [CSS selectors](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors).

```js
;(async () => {
  const buffer = await browserless.screenshot(url.toString(), {
    remove: ['.crisp-client', '#cookies-policy']
  })
})()
```

This sets [`display: none`](https://stackoverflow.com/a/133064/64949) on the matched elements, so it could potentially break the website layout.

##### colorScheme

type: `string`</br>
default: `'no-preference'`

Sets [prefers-color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme) CSS media feature, used to detect if the user has requested the system use a `'light'` or `'dark'` color theme.

##### scripts

type: `string` | `string[]`</br>

Injects [&lt;script&gt;](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script) into the browser page.

It can accept:

- Absolute URLs (e.g., `'https://cdn.jsdelivr.net/npm/@microlink/mql@0.3.12/src/browser.js'`).
- Local file (e.g., `'local-file.js').
- Inline code (e.g., `"document.body.style.backgroundColor = 'red'"`).

```js
;(async () => {
  const buffer = await browserless.screenshot(url.toString(), {
    scripts: [
      'https://cdn.jsdelivr.net/npm/jquery@3.4.1/dist/jquery.min.js',
      'local-file.js',
      "document.body.style.backgroundColor = 'red'"
    ]
  })
})()
```

Prefer to use [modules](#modules) whenever possible.

##### scroll

type: `string` | `object`

Scroll to the DOM element matching the given [CSS selector](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors).

##### styles

type: `string` | `string[]`</br>

Injects [&lt;style&gt;](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/style) into the browser page.

It can accept:

- Absolute URLs (e.g., `'https://cdn.jsdelivr.net/npm/hack@0.8.1/dist/dark.css'`).
- Local file (e.g., `'local-file.css').
- Inline code (e.g., `"body { background: red; }"`).

```js
;(async () => {
  const buffer = await browserless.screenshot(url.toString(), {
    styles: [
      'https://cdn.jsdelivr.net/npm/hack@0.8.1/dist/dark.css',
      'local-file.css',
      'body { background: red; }'
    ]
  })
})()
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

Wait a quantity of time, selector or function using [page.waitForTimeout](https://github.com/puppeteer/puppeteer/blob/main/docs/api.md#pagewaitfortimeoutmilliseconds).

##### waitUntil

type: `string` | `string[]`</br>
default: `'auto'`</br>
values: `'auto'` | `'load'` | `'domcontentloaded'` | `'networkidle0'` | `'networkidle2'`

When to consider navigation succeeded.

If you provide an array of event strings, navigation is considered to be successful after all events have been fired.

Events can be either:

- `'auto'`: A combination of `'load'` and `'networkidle2'` in a smart way to wait the minimum time necessary.
- `'load'`: Consider navigation to be finished when the load event is fired.
- `'domcontentloaded'`: Consider navigation to be finished when the DOMContentLoaded event is fired.
- `'networkidle0'`: Consider navigation to be finished when there are no more than 0 network connections for at least 500 ms.
- `'networkidle2'`: Consider navigation to be finished when there are no more than 2 network connections for at least 500 ms.

### .page()

It returns a standalone [browser new page](https://github.com/GoogleChrome/puppeteer/blob/ddc59b247282774ccc53e3cc925efc30d4e25675/docs/api.md#browsernewpage).

```js
const browserless = require('browserless')

;(async () => {
  const page = await browserless.page()
})()
```

## Command Line Interface

You can perform any **browserless** from CLI installing [`@browserless/cli`](https://npm.im/@browserless/cli) globally:

![](/static/cli.png)

Additionally, can do it under demand using [`npx`](https://npm.im/npx):

```
npx @browserless/cli --help
```

That's useful when you want to do under CI/CD scenarios.

## Pool of Instances

**browserless** uses internally a singleton browser instance.

If you want to keep multiple browsers open, you can use [`@browserless/pool`](https://github.com/microlinkhq/browserless/tree/master/packages/pool) package.

```js
const createBrowserless = require('@browserless/pool')
const onExit = require('signal-exit')

const browserlessPool = createBrowserless({
  max: 2, // max browsers to keep open
  timeout: 30000 // max time a browser is consiedered fresh
})

// pool shutdown gracefully on process exit.
onExit(() => browserlessPool.drain().then(() => browserlessPool.clear()))
```

You can still pass specific puppeteer options as second argument:

```js
const createBrowserless = require('@browserless/pool')

const browserlessPool = createBrowserless(
  {
    max: 2, // max browsers to keep open
    timeout: 30000 // max time a browser is consiedered fresh
  },
  {
    ignoreHTTPSErrors: true,
    args: ['--disable-gpu', '--single-process', '--no-zygote', '--no-sandbox', '--hide-scrollbars']
  }
)
```

After that, the API is the same than **browserless**:

```js
browserlessPool.screenshot('http://example.com', { device: 'iPhone 6' }).then(buffer => {
  console.log('your screenshot is here!')
})
```

Every time you call the pool, it handles acquire and release a new browser instance from the pool ✨.

## Lighthouse

**browserless** has a [Lighthouse](https://developers.google.com/web/tools/lighthouse) integration that uses Puppeteer under the hood.

```js
const lighthouse = require('@browserless/lighthouse')

lighthouse('https://browserless.js.org').then(report => {
  console.log(JSON.stringify(report, null, 2))
})
```

### .lighthouse(url, options)

It generates a report from the target `url`, extending from `lighthouse:default` settings, being these settings the same than Google Chrome Audits reports on Developer Tools.

#### options

The following options are used by default:

```js
{
  logLevel: 'error',
  output: 'json',
  device: 'desktop',
  onlyCategories: ['perfomance', 'best-practices', 'accessibility', 'seo']
}
```

See [Lighthouse configuration](https://github.com/GoogleChrome/lighthouse/blob/master/docs/configuration.md) to know all the options and values supported.

Additionally, you can setup:

##### getBrowserless

type: `function`</br>
default: `require('browserless')`

The browserless instance to use for getting the browser.

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

##### device

type: `string`</br>
default: `'desktop'`</br>
values: `'desktop'` | `'mobile'` | `'none'` </br>

How emulation (useragent, device screen metrics, touch) should be applied. `'none'` indicates Lighthouse should leave the host browser as-is.

##### onlyCategories

type: `string[]` | `null`</br>
default: `['performance', 'best-practices', 'accessibility', 'seo']`</br>
values: `'performance'` | `'best-practices'` | `'accessibility'` | `'pwa'` | `'seo'`

Includes only the specified categories in the final report.

## Packages

**browserless** is internally divided into multiple packages for ensuring just use the mininum quantity of code necessary for your user case.

| Package                                                                                                 | Version                                                                                                                                     | Dependencies                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`browserless`](https://github.com/microlinkhq/browserless/tree/master/packages/browserless)            | [![npm](https://img.shields.io/npm/v/browserless.svg?style=flat-square)](https://www.npmjs.com/package/browserless)                         | [![Dependency Status](https://david-dm.org/microlinkhq/browserless.svg?path=packages/browserless&style=flat-square)](https://david-dm.org/microlinkhq/browserless?path=packages/browserless)            |
| [`@browserless/benchmark`](https://github.com/microlinkhq/browserless/tree/master/packages/benchmark)   | [![npm](https://img.shields.io/npm/v/@browserless/benchmark.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/benchmark)   | [![Dependency Status](https://david-dm.org/microlinkhq/browserless.svg?path=packages/benchmark&style=flat-square)](https://david-dm.org/microlinkhq/browserless?path=packages/@browserless/benchmark)   |
| [`@browserless/cli`](https://github.com/microlinkhq/browserless/tree/master/packages/cli)               | [![npm](https://img.shields.io/npm/v/@browserless/cli.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/cli)               | [![Dependency Status](https://david-dm.org/microlinkhq/browserless.svg?path=packages/cli&style=flat-square)](https://david-dm.org/microlinkhq/browserless?path=packages/@browserless/cli)               |
| [`@browserless/devices`](https://github.com/microlinkhq/browserless/tree/master/packages/devices)       | [![npm](https://img.shields.io/npm/v/@browserless/devices.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/devices)       | [![Dependency Status](https://david-dm.org/microlinkhq/browserless.svg?path=packages/devices&style=flat-square)](https://david-dm.org/microlinkhq/browserless?path=packages/@browserless/devices)       |
| [`@browserless/examples`](https://github.com/microlinkhq/browserless/tree/master/packages/examples)     | [![npm](https://img.shields.io/npm/v/@browserless/examples.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/examples)     | [![Dependency Status](https://david-dm.org/microlinkhq/browserless.svg?path=packages/examples&style=flat-square)](https://david-dm.org/microlinkhq/browserless?path=packages/@browserless/examples)     |
| [`@browserless/errors`](https://github.com/microlinkhq/browserless/tree/master/packages/errors)         | [![npm](https://img.shields.io/npm/v/@browserless/errors.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/errors)         | [![Dependency Status](https://david-dm.org/microlinkhq/browserless.svg?path=packages/errors&style=flat-square)](https://david-dm.org/microlinkhq/browserless?path=packages/@browserless/errors)         |
| [`@browserless/goto`](https://github.com/microlinkhq/browserless/tree/master/packages/goto)             | [![npm](https://img.shields.io/npm/v/@browserless/goto.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/goto)             | [![Dependency Status](https://david-dm.org/microlinkhq/browserless.svg?path=packages/goto&style=flat-square)](https://david-dm.org/microlinkhq/browserless?path=packages/@browserless/goto)             |
| [`@browserless/pdf`](https://github.com/microlinkhq/browserless/tree/master/packages/pdf)               | [![npm](https://img.shields.io/npm/v/@browserless/pdf.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/pdf)               | [![Dependency Status](https://david-dm.org/microlinkhq/browserless.svg?path=packages/pdf&style=flat-square)](https://david-dm.org/microlinkhq/browserless?path=packages/@browserless/pdf)               |
| [`@browserless/pool`](https://github.com/microlinkhq/browserless/tree/master/packages/pool)             | [![npm](https://img.shields.io/npm/v/@browserless/pool.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/pool)             | [![Dependency Status](https://david-dm.org/microlinkhq/browserless.svg?path=packages/pool&style=flat-square)](https://david-dm.org/microlinkhq/browserless?path=packages/@browserless/pool)             |
| [`@browserless/screenshot`](https://github.com/microlinkhq/browserless/tree/master/packages/screenshot) | [![npm](https://img.shields.io/npm/v/@browserless/screenshot.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/screenshot) | [![Dependency Status](https://david-dm.org/microlinkhq/browserless.svg?path=packages/screenshot&style=flat-square)](https://david-dm.org/microlinkhq/browserless?path=packages/@browserless/screenshot) |
| [`@browserless/lighthouse`](https://github.com/microlinkhq/browserless/tree/master/packages/lighthouse) | [![npm](https://img.shields.io/npm/v/@browserless/lighthouse.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/lighthouse) | [![Dependency Status](https://david-dm.org/microlinkhq/browserless.svg?path=packages/lighthouse&style=flat-square)](https://david-dm.org/microlinkhq/browserless?path=packages/@browserless/lighthouse) |

## Benchmark

![](/static/bench.png)

For testing different approaches, we included a tiny benchmark tool called [`@browserless/benchmark`](https://github.com/microlinkhq/browserless/tree/master/packages/benchmark).

## FAQ

**Q: Why use `browserless` over `puppeteer`?**

**browserless** not replace puppeteer, it complements. It's just a syntactic sugar layer over official Headless Chrome oriented for production scenarios.

**Q: Why do you block ads scripts by default?**

Headless navigation is expensive compared with just fetch the content from a website.

In order to speed up the process, we block ads scripts by default because they are so bloat.

**Q: My output is different from the expected**

Probably **browserless** was too smart and it blocked a request that you need.

You can active debug mode using `DEBUG=browserless` environment variable in order to see what is happening behind the code:

```
DEBUG=browserless node index.js
```

Consider open an [issue](https://github.com/microlinkhq/browserless/issues/new) with the debug trace.

**Q: I want to use `browserless` with my AWS Lambda like project**

Yes, check [chrome-aws-lambda](https://github.com/alixaxel/chrome-aws-lambda) to setup AWS Lambda with a binary compatible.

## License

**browserless** © [Microlink](https://microlink.io), Released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Kiko Beats](https://kikobeats.com) with help from [contributors](https://github.com/microlinkhq/browserless/contributors).

The [logo](https://thenounproject.com/term/browser/288309/) has been designed by [xinh studio](https://xinh.studio).

> [microlink.io](https://microlink.io) · GitHub [@MicrolinkHQ](https://github.com/microlinkhq) · Twitter [@microlinkhq](https://twitter.com/microlinkhq)
