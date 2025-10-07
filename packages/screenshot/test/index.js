'use strict'

const { getBrowserContext } = require('@browserless/test/util')
const cheerio = require('cheerio')
const test = require('ava')

const isCI = !!process.env.CI

test('graphics features', async t => {
  const browserless = await getBrowserContext(t)

  const getGpu = browserless.withPage(page => async () => {
    await page.goto('chrome://gpu/')

    const html = await page.evaluate(() => document.querySelector('info-view').shadowRoot.innerHTML)
    await page.close()

    const $ = cheerio.load(html)

    const props = []

    $('#content div:first li').each((_, element) => {
      const key = $(element).find('span:eq(2)').text().trim().slice(0, -1)
      const value = $(element).find('span:eq(3)').text().trim()
      props.push([key, value])
    })

    return Object.fromEntries(props)
  })

  t.deepEqual(
    await getGpu(),
    isCI
      ? {
          Canvas: 'Hardware accelerated',
          'Direct Rendering Display Compositor': 'Disabled',
          Compositing: 'Software only. Hardware acceleration disabled',
          'Multiple Raster Threads': 'Enabled',
          OpenGL: 'Enabled',
          Rasterization: 'Hardware accelerated',
          'Raw Draw': 'Disabled',
          'Skia Graphite': 'Disabled',
          TreesInViz: 'Disabled',
          'Video Decode': 'Hardware accelerated',
          'Video Encode': 'Software only. Hardware acceleration disabled',
          Vulkan: 'Disabled',
          WebGL: 'Hardware accelerated but at reduced performance',
          WebGL2: 'Hardware accelerated but at reduced performance',
          WebGPU: 'Disabled',
          WebNN: 'Disabled'
        }
      : {
          Canvas: 'Hardware accelerated',
          'Direct Rendering Display Compositor': 'Disabled',
          Compositing: 'Software only. Hardware acceleration disabled',
          'Multiple Raster Threads': 'Enabled',
          OpenGL: 'Enabled',
          Rasterization: 'Hardware accelerated',
          'Raw Draw': 'Disabled',
          'Skia Graphite': 'Disabled',
          TreesInViz: 'Disabled',
          'Video Decode': 'Hardware accelerated',
          'Video Encode': 'Hardware accelerated',
          WebGL: 'Hardware accelerated but at reduced performance',
          WebGL2: 'Hardware accelerated but at reduced performance',
          WebGPU: 'Software only, hardware acceleration unavailable',
          WebNN: 'Disabled'
        }
  )
})
