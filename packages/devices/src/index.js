'use strict'

const requireOneOf = require('require-one-of')

const puppeteerDevices = requireOneOf([
  'puppeteer-core/DeviceDescriptors',
  'puppeteer/DeviceDescriptors',
  'puppeteer-firefox/DeviceDescriptors'
])

const customDevices = require('./devices.json')

const devices = puppeteerDevices.concat(customDevices)

const getDevice = deviceName =>
  deviceName && devices.find(device => device.name.toLowerCase() === deviceName.toLowerCase())

module.exports = devices
module.exports.getDevice = getDevice
