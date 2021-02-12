'use strict'

const { devices } = require('..')()
const { chain } = require('lodash')

const HEADER = {
  markdown: () => {
    console.log('| name | width | height | scale | mobile? | touch? | landscape? |')
    console.log('|------|-------|--------|-------------------|----------|----------|-------------|')
  }
}

const ROW = {
  markdown: (name, viewport) => {
    const { width, height, deviceScaleFactor, isMobile, hasTouch, isLandscape } = viewport

    return `| \`${name}\` | ${width} | ${height} | ${deviceScaleFactor} | ${isMobile} | ${hasTouch} | ${isLandscape} |`
  },
  doc: (name, viewport) => {
    return name
  }
}

const format = process.argv[2] || 'markdown'

const deviceStrings = chain(devices)
  .orderBy(['name'], ['asc'])
  .map(({ name, viewport }) => ROW[format](name, viewport))
  .value()

HEADER[format] && HEADER[format]()
deviceStrings.forEach(str => console.log(str))
