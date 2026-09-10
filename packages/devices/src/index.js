'use strict'

const { default: didyoumean } = require('didyoumean3')
const requireOneOf = require('require-one-of')
const memoizeOne = require('memoize-one')

const customDevices = require('./devices.json')

const desktopUserAgent = chromeVersion =>
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`

const syncChromeVersion = (userAgent, chromeVersion) =>
  chromeVersion ? userAgent.replace(/Chrome\/[\d.]+/g, `Chrome/${chromeVersion}`) : userAgent

const withChromeVersion = (source, chromeVersion) => {
  const devices = {}

  for (const [name, device] of Object.entries(source)) {
    const userAgent = device.userAgent
      ? syncChromeVersion(device.userAgent, chromeVersion)
      : chromeVersion
        ? desktopUserAgent(chromeVersion)
        : device.userAgent

    devices[name] = userAgent === device.userAgent ? device : { ...device, userAgent }
  }

  return devices
}

const createGetDevice = ({
  puppeteer = requireOneOf(['puppeteer', 'puppeteer-core', 'puppeteer-firefox']),
  lossyDeviceName = true
} = {}) => {
  const { KnownDevices: puppeteerDevices } = puppeteer
  const chromeVersion = puppeteer.PUPPETEER_REVISIONS?.chrome
  const devices = withChromeVersion({ ...puppeteerDevices, ...customDevices }, chromeVersion)
  const deviceDescriptors = Object.keys(devices)

  const findDevice = memoizeOne((deviceDescriptor, lossyEnabled) => {
    if (!deviceDescriptor) return undefined
    if (!lossyEnabled) return devices[deviceDescriptor]

    const result = didyoumean(deviceDescriptor, deviceDescriptors)
    if (!result) return undefined

    return devices[result.winner]
  })

  const getDevices = ({ device: deviceDescriptor, headers = {}, viewport } = {}) => {
    const device = findDevice(deviceDescriptor, lossyDeviceName)

    return device
      ? {
          userAgent: device.userAgent || headers['user-agent'],
          viewport: { ...device.viewport, ...viewport }
        }
      : {
          userAgent: headers['user-agent'],
          viewport
        }
  }

  getDevices.devices = devices
  getDevices.findDevice = findDevice
  getDevices.deviceDescriptors = deviceDescriptors
  getDevices.chromeVersion = chromeVersion

  return getDevices
}

createGetDevice.syncChromeVersion = syncChromeVersion

module.exports = createGetDevice
