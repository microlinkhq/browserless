'use strict'

const prettyBytes = require('pretty-bytes')

// Navigation Timing uses 0 for milestones that haven't been recorded.
const timing = (ms, label) => (ms > 0 ? `${Math.round(ms)} ms ${label}` : null)

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
        ttfb: nav?.responseStart,
        fcp: fcp?.startTime,
        domContentLoaded: nav?.domContentLoadedEventEnd,
        loadEventEnd: nav?.loadEventEnd
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
    timing(ttfb, 'TTFB'),
    timing(fcp, 'FCP'),
    timing(domContentLoaded, 'DOMContentLoaded'),
    timing(loadEventEnd, 'load')
  ].filter(Boolean)

  return ['\n' + lines.map(line => `  ⬩ ${line}`).join('\n')]
}
