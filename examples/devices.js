'use strict'

const { devices } = require('..')
const { chain } = require('lodash')

const HEADER = {
  markdown: () => {
    console.log(
      `| name | width | height | scale | mobile? | touch? | landscape? |`
    )
    console.log(
      `|------|-------|--------|-------------------|----------|----------|-------------|`
    )
  }
}

const ROW = {
  markdown: (name, viewport) => {
    const {
      width,
      height,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      isLandscape
    } = viewport

    return `| \`${name}\` | ${width} | ${height} | ${deviceScaleFactor} | ${isMobile} | ${hasTouch} | ${isLandscape} |`
  },
  jsx: (name, viewport) => {
    const {
      width,
      height,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      isLandscape
    } = viewport

    return `<Row>
  <BoldCell>${name.toLowerCase()}</BoldCell>
  <Cell>${width}</Cell>
  <Cell>${height}</Cell>
  <Cell>${deviceScaleFactor}</Cell>
  <Cell>${isMobile}</Cell>
  <Cell>${hasTouch}</Cell>
  <Cell>${isLandscape}</Cell>
</Row>`
  }
}

const format = process.argv[2] || 'markdown'

const deviceStrings = chain(devices)
  .orderBy(['name'], ['asc'])
  .map(({ name, viewport }) => ROW[format](name, viewport))
  .value()

HEADER[format] && HEADER[format]()
deviceStrings.forEach(str => console.log(str))
