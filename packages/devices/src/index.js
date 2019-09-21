'use strict'

const customDevices = require('./devices.json')

const getDevice = (devices, deviceName) =>
  deviceName && devices.find(device => device.name.toLowerCase() === deviceName.toLowerCase())

module.exports = puppeteerDevices => {
  const devices = puppeteerDevices.concat(customDevices)
  return {
    devices,
    getDevice: getDevice.bind(null, devices)
  }
}
