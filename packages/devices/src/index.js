'use strict'

const { default: didyoumean } = require('didyoumean3')
const customDevices = require('./devices.json')

module.exports = ({
  puppeteerDevices = require('require-one-of')([
    'puppeteer/DeviceDescriptors',
    'puppeteer-core/DeviceDescriptors',
    'puppeteer-firefox/DeviceDescriptors'
  ]),
  lossyDeviceName = true
} = {}) => {
  const devices = puppeteerDevices.concat(customDevices).reduce(
    (acc, { name, ...props }) => ({
      ...acc,
      [name]: props
    }),
    {}
  )

  const deviceDescriptors = Object.keys(devices)

  const getDevices = ({ headers = {}, device: deviceDescriptor = '', viewport } = {}) => {
    const device =
      devices[
        lossyDeviceName ? didyoumean(deviceDescriptor, deviceDescriptors).winner : deviceDescriptor
      ]

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

  return getDevices
}
