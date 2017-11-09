'use strict'

const { devices } = require('..')
const { chain } = require('lodash')

console.log(`| name | width | height | scale | mobile? | touch? | landscape? |`)
console.log(
  `|------|-------|--------|-------------------|----------|----------|-------------|`
)

const deviceStrings = chain(devices)
  .orderBy(['name'], ['asc'])
  .map(device => {
    const { name, viewport } = device
    const {
      width,
      height,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      isLandscape
    } = viewport

    return `| \`${name}\` | ${width} | ${height} | ${deviceScaleFactor} | ${isMobile} | ${hasTouch} | ${isLandscape} |`
  })
  .value()

deviceStrings.forEach(str => console.log(str))
