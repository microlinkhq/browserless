'use strict'

const prettyBytes = require('pretty-bytes')

module.exports = async ({ url, browserless, opts }) => {
  const pageResources = browserless.evaluate(async page =>
    page.evaluate(() =>
      window.performance.getEntriesByType('resource').map(resource => ({
        transferredSize: resource.transferSize,
        decodedBodySize: resource.decodedBodySize
      }))
    )
  )

  const resources = await pageResources(url, opts)

  const [transferSize, resourcesSize] = resources
    .reduce(
      (acc, { transferredSize, decodedBodySize }) => {
        acc[0] += transferredSize
        acc[1] += decodedBodySize
        return acc
      },
      [0, 0]
    )
    .map(prettyBytes)

  const resume = `
  ⬩ ${resources.length} network requests
  ⬩ ${transferSize} transferred bytes
  ⬩ ${resourcesSize} resources bytes`

  return [resume]
}
