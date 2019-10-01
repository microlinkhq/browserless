'use strict'

const customDevices = require('./devices.json')

const getDevice = (devices, deviceName) =>
  deviceName && devices.find(device => device.name.toLowerCase() === deviceName.toLowerCase())

module.exports = ({
  puppeteerDevices = require('require-one-of')([
    'puppeteer/DeviceDescriptors',
    'puppeteer-core/DeviceDescriptors',
    'puppeteer-firefox/DeviceDescriptors'
  ])
} = {}) => {
  const devices = puppeteerDevices.concat(customDevices)
  return {
    devices,
    getDevice: getDevice.bind(null, devices)
  }
}
