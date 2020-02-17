'use strict'

const customDevices = require('./devices.json')

const findDevice = (devices, deviceName) =>
  devices.find(device => device.name.toLowerCase() === deviceName.toLowerCase())

module.exports = ({
  puppeteerDevices = require('require-one-of')([
    'puppeteer/DeviceDescriptors',
    'puppeteer-core/DeviceDescriptors',
    'puppeteer-firefox/DeviceDescriptors'
  ])
} = {}) => {
  const devices = puppeteerDevices.concat(customDevices)

  return ({ headers = {}, device: deviceId = '', viewport } = {}) => {
    const device = findDevice(devices, deviceId)
    return device
      ? {
          userAgent: device.userAgent || headers['user-agent'],
          viewport: { ...device.viewport, ...viewport }
        }
      : {
          userAgent: headers['user-agent'],
          viewport: {}
        }
  }
}
