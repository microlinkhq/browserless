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

> @browserless/devices: A collection of different devices for emulation purposes.

See [devices section](https://browserless.js.org/#/?id=getdeviceoptions) our website for more information.

## Install

Using npm:

```sh
npm install @browserless/devices --save
```

## About

This package provides a **device descriptor library** for browser emulation. It extends Puppeteer's built-in device list with additional desktop devices and provides fuzzy matching capabilities for device name resolution.

### What this package does

The `@browserless/devices` package allows you to:

- **Emulate devices** by retrieving viewport dimensions, user agent strings, and device capabilities
- **Use fuzzy matching** to resolve device names even with typos or case variations
- **Access extended device list** that includes desktop devices missing from Puppeteer's defaults

### Device properties

Each device descriptor includes:

| Property | Description |
|----------|-------------|
| `userAgent` | Browser user agent string |
| `viewport.width` | Screen width in pixels |
| `viewport.height` | Screen height in pixels |
| `viewport.deviceScaleFactor` | Device pixel ratio (DPR) |
| `viewport.isMobile` | Whether it's a mobile device |
| `viewport.hasTouch` | Whether the device has touch support |
| `viewport.isLandscape` | Whether the device is in landscape mode |

### Custom Devices

This package extends [Puppeteer's KnownDevices](https://pptr.dev/api/puppeteer.knowndevices/) with additional desktop devices:

| Device | Resolution | Scale |
|--------|------------|-------|
| `Macbook Pro 13` | 1280 × 800 | 2x |
| `Macbook Pro 15` | 1440 × 900 | 2x |
| `Macbook Pro 16` | 1536 × 960 | 2x |
| `iMac 21` | 1980 × 1080 | 1x |
| `iMac 21 4K` | 2048 × 1152 | 2x |
| `iMac 24 4.5K` | 4480 × 2520 | 1x |
| `iMac 27` | 2560 × 1440 | 1x |
| `iMac 27 5K` | 2560 × 1440 | 2x |

### Fuzzy Device Name Matching

When `lossyDeviceName` is enabled (default), the package uses fuzzy matching to resolve device names:

```js
const createGetDevice = require('@browserless/devices')
const getDevice = createGetDevice({ lossyDeviceName: true })

// All of these resolve to "Macbook Pro 13"
getDevice({ device: 'Macbook Pro 13' })
getDevice({ device: 'macbook pro 13' })
getDevice({ device: 'MACBOOK PRO 13' })
getDevice({ device: 'macbook pro' })
getDevice({ device: 'macboo pro' })  // typo still works!
```

### Usage

```js
const createGetDevice = require('@browserless/devices')
const getDevice = createGetDevice()

// Get device by name
const device = getDevice({ device: 'iPhone 13' })
// => { userAgent: '...', viewport: { width: 390, height: 844, ... } }

// Override viewport properties
const customDevice = getDevice({
  device: 'iPad',
  viewport: { isLandscape: true }
})

// Use custom headers
const withHeaders = getDevice({
  headers: { 'user-agent': 'googlebot' }
})

// Access all available devices
console.log(getDevice.deviceDescriptors)
```

### How it fits in the monorepo

This is a **standalone utility package** with no dependencies on other `@browserless/*` packages. It's used by:

| Consumer | Purpose |
|----------|---------|
| `@browserless/goto` | Sets viewport and user agent when navigating to URLs |
| `browserless` (core) | Exposes `getDevice()` method on browser contexts |

### Dependencies

| Package | Purpose |
|---------|---------|
| `didyoumean3` | Fuzzy string matching for lossy device name resolution |
| `memoize-one` | Caches device lookups for performance |
| `require-one-of` | Auto-detects puppeteer/puppeteer-core installation |

## License

**@browserless/devices** © [Microlink](https://microlink.io), released under the [MIT](https://github.com/microlinkhq/browserless/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Microlink](https://microlink.io) with help from [contributors](https://github.com/microlinkhq/browserless/contributors).

The [logo](https://thenounproject.com/term/browser/288309/) has been designed by [xinh studio](https://xinh.studio).

> [microlink.io](https://microlink.io) · GitHub [microlinkhq](https://github.com/microlinkhq) · X [@microlinkhq](https://x.com/microlinkhq)
