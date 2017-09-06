# browserless

![Last version](https://img.shields.io/github/tag/Kikobeats/browserless.svg?style=flat-square)
[![Build Status](https://img.shields.io/travis/Kikobeats/browserless/master.svg?style=flat-square)](https://travis-ci.org/Kikobeats/browserless)
[![Coverage Status](https://img.shields.io/coveralls/Kikobeats/browserless.svg?style=flat-square)](https://coveralls.io/github/Kikobeats/browserless)
[![Dependency status](https://img.shields.io/david/Kikobeats/browserless.svg?style=flat-square)](https://david-dm.org/Kikobeats/browserless)
[![Dev Dependencies Status](https://img.shields.io/david/dev/Kikobeats/browserless.svg?style=flat-square)](https://david-dm.org/Kikobeats/browserless#info=devDependencies)
[![NPM Status](https://img.shields.io/npm/dm/browserless.svg?style=flat-square)](https://www.npmjs.org/package/browserless)
[![Donate](https://img.shields.io/badge/donate-paypal-blue.svg?style=flat-square)](https://paypal.me/Kikobeats)

> Simple & Functional Browser API.

This module is an API simplification over [Chrome Headless API](https://github.com/GoogleChrome/puppeteer) for do common actions, like take an screenshot.

## Install

```bash
$ npm install browserless --save
```

## Usage

```js
const browserless = require('browserless')

browserless('do something')
//=> return something
```

## API

All methods needs a  valid `url` as required first argument. The second argument will be `opts` for configure specific method settings.

All methods expose an universal `promise`/`callback` interface: If you provide a function as last argument, then the output of the method will be following `callback` style. Otherwise, it returns an `promise`.

### .html(url, [options], [cb])

It returns the full HTML extracted from the URL.

`opts` provided are passed to [page.goto](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options).

### .pdf(url, [options], [cb])

`opts` provided are passed to [page.goto](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options).

Additionally you can setup the CSS media providing `opts.media` (by default it will be `'screen'`). This value will be passed to [page.emulateMedia](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pageemulatemediamediatype).

### .screenshot(url, [options], [cb])

It takes an screenshot of the URL.

`opts` provided are passed to [page.screenshot](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagescreenshotoptions).

Additionally, you can setup the `device` providing `opts.device` and a valid [deviceDescriptor](https://github.com/GoogleChrome/puppeteer/blob/master/DeviceDescriptors.js).

It returns an [tmpStream](https://github.com/Kikobeats/create-temp-file2#create-temp-file2), with `path` where the temporal file live and `cleanup`/`cleanupSync` methods for clean the temporal file.

If you want to customize where tmpStream live, pass [opts.tmpOptions](https://github.com/Kikobeats/create-temp-file2#createtempfileoptions).

### .text(url, [options], [cb])

It returns the text extracted from the URL.

`opts` provided are passed to [page.goto](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegotourl-options).

## License

**browserless** © [Kiko Beats](https://kikobeats.com), Released under the [MIT](https://github.com/Kikobeats/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by Kiko Beats with help from [contributors](https://github.com/Kikobeats/browserless/contributors).

> [kikobeats.com](https://kikobeats.com) · GitHub [Kiko Beats](https://github.com/kikobeats) · Twitter [@kikobeats](https://twitter.com/kikobeats)
