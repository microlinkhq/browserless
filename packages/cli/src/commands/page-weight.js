'use strict'

const prettyBytes = require('pretty-bytes')

const prettyMs = ms => (ms == null ? null : `${Math.round(ms)} ms`)

module.exports = async ({ url, browserless, opts }) => {
  const getPageWeight = browserless.evaluate(async page =>
    page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0]
      const paint = performance.getEntriesByType('paint')
      const fcp = paint.find(e => e.name === 'first-contentful-paint')

      return {
        resources: performance.getEntriesByType('resource').map(resource => ({
          transferredSize: resource.transferSize,
          decodedBodySize: resource.decodedBodySize
        })),
        ttfb: nav?.responseStart ?? null,
        fcp: fcp?.startTime ?? null,
        domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
        loadEventEnd: nav?.loadEventEnd ?? null
      }
    })
  )

  const { resources, ttfb, fcp, domContentLoaded, loadEventEnd } = await getPageWeight(url, opts)

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

  const lines = [
    `${resources.length} network requests`,
    `${transferSize} transferred bytes`,
    `${resourcesSize} resources bytes`,
    ttfb != null && `${prettyMs(ttfb)} TTFB`,
    fcp != null && `${prettyMs(fcp)} FCP`,
    domContentLoaded != null && `${prettyMs(domContentLoaded)} DOMContentLoaded`,
    loadEventEnd != null && `${prettyMs(loadEventEnd)} load`
  ].filter(Boolean)

  return ['\n' + lines.map(line => `  ⬩ ${line}`).join('\n')]
}
