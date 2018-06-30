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
[![Donate](https://img.shields.io/badge/donate-paypal-blue.svg?style=flat-square)](https://paypal.me/Kikobeats)

## Features

- High level automation API on top [Headless Chrome](https://github.com/GoogleChrome/puppeteer).
- Oriented for production & performance scenarios.
- Aborting unnecessary requests based on MIME types.
- Blocking [ads trackers](https://npm.im/is-tracking-domain) by default.

## Install

```bash
$ npm install puppeteer browserless --save
```

## Usage

**browserless** is an high level API simplification over  for do common actions.

For example, if you want to take an screenshot, just do:

```js
const browserless = require('browserless')()

browserless
  .screenshot('http://example.com', { device: 'iPhone 6' })
  .then(tmpStream => {
    console.log(`your screenshot at ${tmpStream.path}`)
    tmpStream.cleanupSync()
  })
```

See more at [examples](/examples/).

## Basic

All methods follow the same interface:

- `url`: The target URL (*required*).
- `options`: Specific settings for the method (*optional*).
- `callback`: Node.js callback. If you don't provide one, the method will be return a `promise`.

### .constructor(options)

It creates the `browser` instance, using [puppeter.launch](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#puppeteerlaunchoptions) method.

```js
// Creating a simple instance
const browserless = require('browserless')()
```

or passing specific launchers options:

```
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

By default the library will be pass a well known list of flags, so probably you don't need any additional setup.

### .html(url, options)

It returns the full HTML content from the target `url`.

```js
const browserless = require('browserless')

;(async () => {
  const url = 'https://example.com'
  const html = await browserless.html(url)
  console.log(html)
})()
```

This method accepts `options` that will be pased to [page.goto](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options).

Additionally, you can setup:

#### waitFor

type:`string|function|number`</br>
default: `0`

Wait a quantity of time, selector or function using [page.waitFor](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagewaitforselectororfunctionortimeout-options-args).

#### waitUntil

type:`array`</br>
default: `['networkidle2', 'load', 'domcontentloaded']`

Specify a list of events until consider navigation succeeded, using [page.waitForNavigation](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagewaitfornavigationoptions).

#### userAgent

It will setup a custom user agent, using [page.setUserAgent](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagesetuseragentuseragent) method.

#### viewport

It will setup a custom viewport, using [page.setViewport](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagesetviewportviewport) method.

#### abortTypes

type: `array` </br>
default: `['image', 'media', 'stylesheet', 'font', 'xhr']`

A list of `resourceType` requests that can be aborted in order to make the process faster.

##### abortTrackers

type: `boolean`</br>
default: `true`

It will be abort request coming for [tracking domains](https://npm.im/is-tracking-domain).

### .text(url, options)

It returns the full text content from the target `url`.

```js
const browserless = require('browserless')

;(async () => {
  const url = 'https://example.com'
  const text = await browserless.text(url)
  console.log(text)
})()
```

All `options` that you can pass are the same than [`.html`](#html) method.

### .pdf(url, options)

It generates the PDF version of a website behind an `url`.

```js
const browserless = require('browserless')

;(async () => {
  const url = 'https://example.com'
  const tmpStream = await browserless.pdf(url, {
    tmpOpts: {
      path: './',
      name: `${url.hostname}.${Date.now()}`
    }
  })

  console.log(`PDF generated at '${tmpStream.path}'`)
  tmpStream.cleanupSync() // It removes the file!
})()
```

It returns an [tmpStream](https://github.com/Kikobeats/create-temp-file2#create-temp-file2), with `path` where the temporal file live and `cleanup`/`cleanupSync` methods for clean the temporal file.

The `options` provided are passed to [page.pdf](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagepdfoptions).

If you want to customize tmpStream settings, pass [opts.tmpOptions](https://github.com/Kikobeats/create-temp-file2#createtempfileoptions).

Additionally, you can setup:

#### media

Changes the CSS media type of the page using [page.emulateMedia](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pageemulatemediamediatype).

#### device

It generate the PDF using the [device](https://github.com/GoogleChrome/puppeteer/blob/master/DeviceDescriptors.js) descriptor name settings, like `userAgent` and `viewport`.

#### userAgent

It will setup a custom user agent, using [page.setUserAgent](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagesetuseragentuseragent) method.

#### viewport

It will setup a custom viewport, using [page.setViewport](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagesetviewportviewport) method.

### .screenshot(url, options)

It takes a screenshot from the target `url`

```js
const browserless = require('browserless')

;(async () => {
  const url = 'https://example.com'
  const tmpStream = await browserless.screenshot(url, {
    tmpOpts: {
      path: './',
      name: `${url.hostname}.${Date.now()}`
    }
  })

  console.log(`Screenshot taken at '${tmpStream.path}'`)
  tmpStream.cleanupSync() // It removes the file!
})()
```

It returns an [tmpStream](https://github.com/Kikobeats/create-temp-file2#create-temp-file2), with `path` where the temporal file live and `cleanup`/`cleanupSync` methods for clean the temporal file.

The `options` provided are passed to [page.pdf](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagepdfoptions).

If you want to customize tmpStream settings, pass [opts.tmpOptions](https://github.com/Kikobeats/create-temp-file2#createtempfileoptions).

Additionally, you can setup:

#### device

It generate the PDF using the [device](https://github.com/GoogleChrome/puppeteer/blob/master/DeviceDescriptors.js) descriptor name settings, like `userAgent` and `viewport`.

#### userAgent

It will setup a custom user agent, using [page.setUserAgent](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagesetuseragentuseragent) method.

#### viewport

It will setup a custom viewport, using [page.setViewport](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagesetviewportviewport) method.

## Advanced

The following methods are exposed to be used in scenarios where you need more granuality control and less magic.

### .browser

It returns the internal [browser](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#class-browser) instance used as singleton.

```js
const browserless = require('browserless')

;(async () => {
  const browserInstance = await browserless.browser
})()
```

### .evaluate

It exposes an interface for creating your own evaluate function.

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

Internally the method performs a [.goto](#gotopage-options) operation and it will pass you the `page` and `reponse`.

### .page()

It returns a standalone [browser new page](https://github.com/GoogleChrome/puppeteer/blob/ddc59b247282774ccc53e3cc925efc30d4e25675/docs/api.md#browsernewpage).

```js
const browserless = require('browserless')

;(async () => {
  const page = await browserless.page()
})()
```

### .goto(page, options)

It performs a smart [page.goto](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options), blocking [ads trackers](https://npm.im/is-tracking-domain)) requests and other requests based on `resourceType`.

```js
const browserless = require('browserless')

;(async () => {
  const page = await browserless.page()
  await browserless.goto(page, {
    url: 'http://savevideo.me',
    abortTypes: ['image', 'media', 'stylesheet', 'font']
  })
})()
```

#### options

##### url

type: `string`

The target URL

##### abortTypes

type: `string`</br>
default: `[]`

A list of `req.resourceType()` to be blocked.

##### abortTrackers

type: `boolean`</br>
default: `true`

It will be abort request coming for [tracking domains](https://npm.im/is-tracking-domain).

##### abortTrackers

type: `boolean`</br>
default: `true`

It will be abort request coming for [tracking domains](https://npm.im/is-tracking-domain).

##### waitFor

type:`string|function|number`</br>
default: `0`

Wait a quantity of time, selector or function using [page.waitFor](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagewaitforselectororfunctionortimeout-options-args).

##### waitUntil

type:`array`</br>
default: `['networkidle2', 'load', 'domcontentloaded']`

Specify a list of events until consider navigation succeeded, using [page.waitForNavigation](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagewaitfornavigationoptions).

##### userAgent

It will setup a custom user agent, using [page.setUserAgent](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagesetuseragentuseragent) method.

##### viewport

It will setup a custom viewport, using [page.setViewport](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagesetviewportviewport) method.

##### args

type: `object`

The settings to be passed to [page.goto](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options).


## FAQ

**Q: Why use browserless over Puppeteer?**

**browserless** not replace puppeteer, it complements. It's just a syntactic sugar layer over official Headless Chrome.

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

Yes, check [aws-lambda-chrome](https://github.com/Kikobeats/aws-lambda-chrome) to setup AWS Lambda with a binary compatible.

## Related

- [aws-lambda-chrome](https://github.com/Kikobeats/aws-lambda-chrome) – Chrome binary compatible with AWS Lambda.

## License

**browserless** © [Kiko Beats](https://kikobeats.com), Released under the [MIT](https://github.com/kikobeats/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by Kiko Beats with help from [contributors](https://github.com/kikobeats/browserless/contributors).  

[logo](https://thenounproject.com/term/browser/288309/) designed by [xinh studio](https://xinh.studio/).

> [kikobeats.com](https://kikobeats.com) · GitHub [Kiko Beats](https://github.com/kikobeats) · Twitter [@kikobeats](https://twitter.com/kikobeats)
