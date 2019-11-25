<h1 align="center">
  <img style="width: 500px; margin:3rem 0 1.5rem;" src="/static/logo-banner.png" alt="browserless">
  <br>
</h1>

![Last version](https://img.shields.io/github/tag/Kikobeats/browserless.svg?style=flat-square)
[![Build Status](https://img.shields.io/travis/Kikobeats/browserless/master.svg?style=flat-square)](https://travis-ci.org/Kikobeats/browserless)
[![Coverage Status](https://img.shields.io/coveralls/Kikobeats/browserless.svg?style=flat-square)](https://coveralls.io/github/Kikobeats/browserless)
[![Dependency status](https://img.shields.io/david/Kikobeats/browserless.svg?style=flat-square)](https://david-dm.org/Kikobeats/browserless)
[![Dev Dependencies Status](https://img.shields.io/david/dev/Kikobeats/browserless.svg?style=flat-square)](https://david-dm.org/Kikobeats/browserless#info=devDependencies)
[![NPM Status](https://img.shields.io/npm/dm/browserless.svg?style=flat-square)](https://www.npmjs.org/package/browserless)

> A [puppeteer](https://github.com/GoogleChrome/puppeteer)-like Node.js library for interacting with Headless production scenarios.

## Why

Although you can think [puppeteer](https://github.com/GoogleChrome/puppeteer) could be enough, there is a set of use cases that make sense built on top of puppeteer and they are necessary to support into robust production scenario, like:

- Sensible good defaults, aborting unnecessary requests based of what you are doing (e.g, aborting image request if you just want to get [`.html`](#htmlurl-options) content).
- Easily create a pool of instance (via [`@browserless/pool`](#pool-of-instances)).
- Built-in adblocker for aborting ads requests.

## Install

**browserless** is built on top of puppeteer, so you need to install it as well.

```bash
$ npm install puppeteer browserless --save
```

You can use **browserless** together with [`puppeteer`](https://www.npmjs.com/package/puppeteer), [`puppeteer-core`](https://www.npmjs.com/package/puppeteer-core) or [`puppeteer-firefox`](https://www.npmjs.com/package/puppeteer-firefox).

Internally, the library is divided into different packages based on the functionality

## Usage

The **browserless** API is like puppeteer, but doing more things under the hood (not too much, I promise).

For example, if you want to take an [`screenshot`](#screenshoturl-options), just do:

```js
const browserless = require('browserless')()

browserless
  .screenshot('http://example.com', { device: 'iPhone 6' })
  .then(buffer => {
    console.log(`your screenshot is here!`)
  })
```

You can see more common recipes at [`@browserless/examples`](https://github.com/Kikobeats/browserless/tree/master/packages/examples).

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
  args: [
    '--disable-gpu',
    '--single-process',
    '--no-zygote',
    '--no-sandbox',
    '--hide-scrollbars'
  ]
})
```

#### options

See [puppeteer.launch#options](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#puppeteerlaunchoptions).

Additionally, you can setup:

##### timeout

type: `number`</br>
default: `30000`

This setting will change the default maximum navigation time.

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

This method use the following options by default:

```js
{
  disableAnimations = false,
  waitUntil: 'domcontentloaded'
}
```

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

This method use the following options by default:

```js
{
  disableAnimations = false,
  waitUntil: 'domcontentloaded'
}
```

See [browserless.goto](/#gotopage-options) to know all the options and values supported.

### .pdf(url, options)

It generates the PDF version of a website behind an `url`.

```js
const browserless = require('browserless')

;(async () => {
  const url = 'https://example.com'
  const buffer = await browserless.pdf(url)
  console.log(`PDF generated!`)
})()
```

#### options

This method use the following options by default:

```js
{
  disableAnimations: true,
  margin: getMargin('0.25cm'),
  media: 'screen',
  printBackground: true,
  scale = 0.65,
  waitUntil: 'networkidle0'
}
```

See [browserless.goto](/#gotopage-options) to know all the options and values supported.

Also, any [page.pdf](https://github.com/puppeteer/puppeteer/blob/master/docs/api.md#pagepdfoptions) option is supported.

Additionally, you can setup:

##### margin

type: `string` | `string[]`</br>
default: `'0.25cm'`

It sets the paper margins. 

You can pass an `object` object specifing each corner side of the paper:

```js
;(async () => {
  const buffer = await browserless.pdf(url.toString(), {
    margin: {
      top: '0.25cm',
      bottom: '0.25cm',
      left: '0.25cm',
      right: '0.25cm'
    }
  })
})()
```

Or, in case you pass an `string`, it will be used for all the sides:

```js
;(async () => {
  const buffer = await browserless.pdf(url.toString(), { 
    margin: '0.25cm' 
    }
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
  console.log(`Screenshot taken!`)
})()
```

#### options

See [browserless.goto](/#gotopage-options).

Also, any [page.screenshot](https://github.com/puppeteer/puppeteer/blob/master/docs/api.md#pagescreenshotoptions) option is supported.

Additionally, you can setup:

##### click

type: `string` | `string[]`</br>

Click the DOM element matching the given [CSS selector](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors).

##### hide

type: `string` | `string[]`</br>

Hide DOM elements matching the given [CSS selectors](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors).

Can be useful for cleaning up the page.

```js

;(async () => {
  const buffer = await browserless.screenshot(url.toString(), {
    hide: ['.crisp-client', '#cookies-policy']
  })
})()
```

This sets [`visibility: hidden`](https://stackoverflow.com/a/133064/64949) on the matched elements.

##### modules

type: `string` | `string[]`</br>

Inject [JavaScript modules](https://developers.google.com/web/fundamentals/primers/modules) into the page.

Accepts an array of inline code, absolute URLs, and local file paths (must have a `.js` extension).

```js
;(async () => {
  const buffer = await browserless.screenshot(url.toString(), {
    modules: ['https://cdn.jsdelivr.net/npm/@microlink/mql@0.3.12/src/browser.js', 'local-file.js', `document.body.style.backgroundColor = 'red`]
  })
})()
```

##### scripts

type: `string` | `string[]`</br>

Same as the `modules` option, but instead injects the code as [`<script>` instead of `<script type="module">`](https://developers.google.com/web/fundamentals/primers/modules). Prefer the `modules` option whenever possible.

```js
;(async () => {
  const buffer = await browserless.screenshot(url.toString(), {
    scripts: ['https://cdn.jsdelivr.net/npm/jquery@3.4.1/dist/jquery.min.js', 'local-file.js', `document.body.style.backgroundColor = 'red`]
  })
})()
```

##### styles

type: `string` | `string[]`</br>

Inject CSS styles into the page.

Accepts an array of inline code, absolute URLs, and local file paths (must have a `.css` extension).

```js
;(async () => {
  const buffer = await browserless.screenshot(url.toString(), {
    styles: ['https://cdn.jsdelivr.net/npm/hack@0.8.1/dist/dark.css', 'local-file.css', `body { background: red; }`, ``]
  })
})()
```

##### scrollTo

type: `string` | `object`

Scroll to the DOM element matching the given [CSS selector](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors).

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
      background: 'linear-gradient(45deg, rgba(255,18,223,1) 0%, rgba(69,59,128,1) 66%, rgba(69,59,128,1) 100%)'
    }
  })
})()
```

### .devices

List of all available devices preconfigured with `deviceName`, `viewport` and `userAgent` settings.

These devices are used for emulation purposes. It extends from [puppeteer.devices](https://github.com/puppeteer/puppeteer/blob/master/docs/api.md#puppeteerdevices).

#### .getDevice(deviceName)

Get a specific device descriptor settings by descriptor name.

```js
const browserless = require('browserless')

browserless.getDevice('Macbook Pro 15')

// {
//   name: 'Macbook Pro 15',
//   userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X …',
//   viewport: {
//     width: 1440,
//     height: 900,
//     deviceScaleFactor: 1,
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

const getText = browserless.evaluate(
  page => page.evaluate(() => document.body.innerText), {
    waitUntil: 'domcontentloaded',
    disableAnimations: false
  })

;(async () => {
  const url = 'https://example.com'
  const text = await getText(url)

  console.log(text)
})()
```

### .goto(page, options)

It performs a smart [page.goto](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options), using a builtin [adblocker](https://www.npmjs.com/package/@cliqz/adblocker).

```js
const browserless = require('browserless')

;(async () => {
  const page = await browserless.page()
  await browserless.goto(page, { url: 'http://example.com' })
})()
```

#### options

Any option passed here will bypass to [page.goto](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options).

Additionally, you can setup:

##### adblock

type: `boolean`</br>
default: `true`

It will be abort requests detected as ads.

##### device

type: `string`</br>
default: `'macbook pro 13'`

It specifies the [device](#devices) descriptor to use in order to retrieve `userAgent` and `viewport`

##### disableAnimations

Type: `boolean`<br>
Default: `true`

Disable CSS [animations](https://developer.mozilla.org/en-US/docs/Web/CSS/animation) and [transitions](https://developer.mozilla.org/en-US/docs/Web/CSS/transition).

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

##### media

type: `string`</br>
default: `'screen'`

Changes the CSS media type of the page using [page.emulateMedia](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pageemulatemediamediatype).

##### url

type: `string`

The target URL.

##### viewport

It will setup a custom viewport, using [page.setViewport](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagesetviewportviewport) method.

##### waitFor

type:`string|function|number`</br>
default: `0`

Wait a quantity of time, selector or function using [page.waitFor](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagewaitforselectororfunctionortimeout-options-args).

##### waitUntil

type: `string` | `string[]`</br>
default: `['networkidle0']`

Specify a list of events until consider navigation succeeded, using [page.waitForNavigation](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagewaitfornavigationoptions).

### .page()

It returns a standalone [browser new page](https://github.com/GoogleChrome/puppeteer/blob/ddc59b247282774ccc53e3cc925efc30d4e25675/docs/api.md#browsernewpage).

```js
const browserless = require('browserless')

;(async () => {
  const page = await browserless.page()
})()
```

## Pool of Instances

**browserless** uses internally a singleton browser instance.

If you want to keep multiple browsers open, you can use [`@browserless/pool`](https://github.com/Kikobeats/browserless/tree/master/packages/pool) package.

```js
const createBrowserless = require('@browserless/pool')

const browserlessPool = createBrowserless({
  max: 2, // max browsers to keep open
  timeout: 30000 // max time a browser is consiedered fresh
})
```

You can still pass specific puppeteer options as second argument:

```js
const createBrowserless = require('@browserless/pool')

const browserlessPool = createBrowserless({
  max: 2, // max browsers to keep open
  timeout: 30000 // max time a browser is consiedered fresh
}, {
  ignoreHTTPSErrors: true,
  args: [
    '--disable-gpu',
    '--single-process',
    '--no-zygote',
    '--no-sandbox',
    '--hide-scrollbars'
  ]
})
```

After that, the API is the same than **browserless**:

```js
browserlessPool
  .screenshot('http://example.com', { device: 'iPhone 6' })
  .then(buffer => {
    console.log(`your screenshot is here!`)
  })
```

Every time you call the pool, it handles acquire and release a new browser instance from the pool ✨.

## Packages

**browserless** is internally divided into multiple packages for ensuring just use the mininum quantity of code necessary for your user case.

| Package | Version | Dependencies |
|--------|-------|------------|
| [`browserless`](https://github.com/kikobeats/browserless/tree/master/packages/browserless) | [![npm](https://img.shields.io/npm/v/browserless.svg?style=flat-square)](https://www.npmjs.com/package/browserless) | [![Dependency Status](https://david-dm.org/kikobeats/browserless.svg?path=packages/browserless&style=flat-square)](https://david-dm.org/kikobeats/browserless?path=packages/browserless) |
| [`@browserless/benchmark`](https://github.com/kikobeats/browserless/tree/master/packages/benchmark) | [![npm](https://img.shields.io/npm/v/@browserless/benchmark.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/benchmark) | [![Dependency Status](https://david-dm.org/kikobeats/browserless.svg?path=packages/benchmark&style=flat-square)](https://david-dm.org/kikobeats/browserless?path=packages/@browserless/benchmark) |
| [`@browserless/devices`](https://github.com/kikobeats/browserless/tree/master/packages/devices) | [![npm](https://img.shields.io/npm/v/@browserless/devices.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/devices) | [![Dependency Status](https://david-dm.org/kikobeats/browserless.svg?path=packages/devices&style=flat-square)](https://david-dm.org/kikobeats/browserless?path=packages/@browserless/devices) |
| [`@browserless/examples`](https://github.com/kikobeats/browserless/tree/master/packages/examples) | [![npm](https://img.shields.io/npm/v/@browserless/examples.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/examples) | [![Dependency Status](https://david-dm.org/kikobeats/browserless.svg?path=packages/examples&style=flat-square)](https://david-dm.org/kikobeats/browserless?path=packages/@browserless/examples) |
| [`@browserless/goto`](https://github.com/kikobeats/browserless/tree/master/packages/goto) | [![npm](https://img.shields.io/npm/v/@browserless/goto.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/goto) | [![Dependency Status](https://david-dm.org/kikobeats/browserless.svg?path=packages/goto&style=flat-square)](https://david-dm.org/kikobeats/browserless?path=packages/@browserless/goto) |
| [`@browserless/pdf`](https://github.com/kikobeats/browserless/tree/master/packages/pdf) | [![npm](https://img.shields.io/npm/v/@browserless/pdf.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/pdf) | [![Dependency Status](https://david-dm.org/kikobeats/browserless.svg?path=packages/pdf&style=flat-square)](https://david-dm.org/kikobeats/browserless?path=packages/@browserless/pdf) |
| [`@browserless/pool`](https://github.com/kikobeats/browserless/tree/master/packages/pool) | [![npm](https://img.shields.io/npm/v/@browserless/pool.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/pool) | [![Dependency Status](https://david-dm.org/kikobeats/browserless.svg?path=packages/pool&style=flat-square)](https://david-dm.org/kikobeats/browserless?path=packages/@browserless/pool) |
| [`@browserless/screenshot`](https://github.com/kikobeats/browserless/tree/master/packages/screenshot) | [![npm](https://img.shields.io/npm/v/@browserless/screenshot.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/screenshot) | [![Dependency Status](https://david-dm.org/kikobeats/browserless.svg?path=packages/screenshot&style=flat-square)](https://david-dm.org/kikobeats/browserless?path=packages/@browserless/screenshot) |
| [`@browserless/stats`](https://github.com/kikobeats/browserless/tree/master/packages/stats) | [![npm](https://img.shields.io/npm/v/@browserless/stats.svg?style=flat-square)](https://www.npmjs.com/package/@browserless/stats) | [![Dependency Statsus](https://david-dm.org/kikobeats/browserless.svg?path=packages/stats&style=flat-square)](https://david-dm.org/kikobeats/browserless?path=packages/@browserless/stats) |

## Benchmark

![](/static/bench.png)

For testing different approach, we included a tiny benchmark tool called [`@browserless/benchmark`](https://github.com/Kikobeats/browserless/tree/master/packages/benchmark).

## FAQ

**Q: Why use browserless over Puppeteer?**

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

Consider open an [issue](https://github.com/Kikobeats/browserless/issues/new) with the debug trace.

**Q: Can I use browserless with my AWS Lambda like project?**

Yes, check [chrome-aws-lambda](https://github.com/alixaxel/chrome-aws-lambda) to setup AWS Lambda with a binary compatible.

## License

**browserless** © [Kiko Beats](https://kikobeats.com), Released under the [MIT](https://github.com/kikobeats/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by Kiko Beats with help from [contributors](https://github.com/kikobeats/browserless/contributors).  

[logo](https://thenounproject.com/term/browser/288309/) designed by [xinh studio](https://xinh.studio/).

> [kikobeats.com](https://kikobeats.com) · GitHub [Kiko Beats](https://github.com/kikobeats) · Twitter [@kikobeats](https://twitter.com/kikobeats)
