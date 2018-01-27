# browserless

![Last version](https://img.shields.io/github/tag/microlinkhq/browserless.svg?style=flat-square)
[![Build Status](https://img.shields.io/travis/microlinkhq/browserless/master.svg?style=flat-square)](https://travis-ci.org/microlinkhq/browserless)
[![Coverage Status](https://img.shields.io/coveralls/microlinkhq/browserless.svg?style=flat-square)](https://coveralls.io/github/microlinkhq/browserless)
[![Dependency status](https://img.shields.io/david/microlinkhq/browserless.svg?style=flat-square)](https://david-dm.org/microlinkhq/browserless)
[![Dev Dependencies Status](https://img.shields.io/david/dev/microlinkhq/browserless.svg?style=flat-square)](https://david-dm.org/microlinkhq/browserless#info=devDependencies)
[![NPM Status](https://img.shields.io/npm/dm/browserless.svg?style=flat-square)](https://www.npmjs.org/package/browserless)
[![Donate](https://img.shields.io/badge/donate-paypal-blue.svg?style=flat-square)](https://paypal.me/Kikobeats)

> Chrome Headless API made easy

This module is an API simplification over [Chrome Headless API](https://github.com/GoogleChrome/puppeteer) for do common actions, like take an screenshot:

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

## Install

```bash
$ npm install browserless --save
```

## API

All methods needs a  valid `url` as required first argument. The second argument will be `opts` for configure specific method settings.

All methods expose an universal `promise`/`callback` interface: If you provide a function as last argument, then the output of the method will be following `callback` style. Otherwise, it returns an `promise`.

### .constructor([opts])

Setup [puppeter.launch](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#puppeteerlaunchoptions) instance.

### .html(url, [opts], [cb])

It returns the full HTML extracted from the URL.

`opts` provided are passed to [page.goto](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options).

### .pdf(url, [opts], [cb])

It generates the PDF version of a website behing an URL.

`opts` provided are passed to [page.pdf](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagepdfoptions).

It returns an [tmpStream](https://github.com/Kikobeats/create-temp-file2#create-temp-file2), with `path` where the temporal file live and `cleanup`/`cleanupSync` methods for clean the temporal file.

If you want to customize where tmpStream live, pass [opts.tmpOptions](https://github.com/Kikobeats/create-temp-file2#createtempfileoptions).

Additionally, you can setup:

#### media

Changes the CSS media type of the page using [page.emulateMedia](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pageemulatemediamediatype).

#### device

Providing a valid [deviceDescriptor](https://github.com/GoogleChrome/puppeteer/blob/master/DeviceDescriptors.js) object.

The device will be used to recover and setup `userAgent` and `viewport`.

#### userAgent

It will setup User Agent using [page.setUserAgent](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagesetuseragentuseragent) method.

#### viewport

Providing a valid [page.setViewport](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagesetviewportviewport) object.

### .screenshot(url, [opts], [cb])

It takes an screenshot of the URL.

`opts` provided are passed to [page.screenshot](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagescreenshotoptions).

It returns an [tmpStream](https://github.com/Kikobeats/create-temp-file2#create-temp-file2), with `path` where the temporal file live and `cleanup`/`cleanupSync` methods for clean the temporal file.

If you want to customize where tmpStream live, pass [opts.tmpOptions](https://github.com/Kikobeats/create-temp-file2#createtempfileoptions).

Additionally, you can setup:

#### device

Providing a valid [deviceDescriptor](https://github.com/GoogleChrome/puppeteer/blob/master/DeviceDescriptors.js) object.

The device will be used to recover and setup `userAgent` and `viewport`.

#### userAgent

It will setup User Agent using [page.setUserAgent](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagesetuseragentuseragent) method.

#### viewport

Providing a valid [page.setViewport](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagesetviewportviewport) object.

### .text(url, [options], [cb])

It returns the text extracted from the URL.

`opts` provided are passed to [page.goto](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options).

### .page()

Get an standalone [browser new page](https://github.com/GoogleChrome/puppeteer/blob/ddc59b247282774ccc53e3cc925efc30d4e25675/docs/api.md#browsernewpage).

## License

**browserless** © [Kiko Beats](https://kikobeats.com), Released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by Kiko Beats with help from [contributors](https://github.com/microlinkhq/browserless/contributors).

> [kikobeats.com](https://kikobeats.com) · GitHub [Kiko Beats](https://github.com/kikobeats) · Twitter [@kikobeats](https://twitter.com/kikobeats)
