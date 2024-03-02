'use strict'

const { default: didyoumean } = require('didyoumean3')
const requireOneOf = require('require-one-of')
const memoizeOne = require('memoize-one')

const customDevices = require('./devices.json')

module.exports = ({
  puppeteer = requireOneOf(['puppeteer', 'puppeteer-core', 'puppeteer-firefox']),
  lossyDeviceName = true
} = {}) => {
  const { KnownDevices: puppeteerDevices } = puppeteer
  const devices = { ...puppeteerDevices, ...customDevices }
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

  return getDevices
}
