'use strict'

const { default: didyoumean } = require('didyoumean3')
const requireOneOf = require('require-one-of')

const customDevices = require('./devices.json')

module.exports = ({
  puppeteerDevices = requireOneOf(['puppeteer', 'puppeteer-core', 'puppeteer-firefox']).devices,
  lossyDeviceName = false
} = {}) => {
  const devices = { ...puppeteerDevices.devicesMap, ...customDevices }
  const deviceDescriptors = Object.keys(devices)

  const findDevice = (deviceDescriptor, lossyEnabled) => {
    if (!deviceDescriptor) return undefined
    if (!lossyEnabled) return devices[deviceDescriptor]

    const result = didyoumean(deviceDescriptor, deviceDescriptors)
    if (!result) return undefined

    return devices[result.winner]
  }

  const getDevices = ({ headers = {}, device: deviceDescriptor, viewport } = {}) => {
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

  return getDevices
}
