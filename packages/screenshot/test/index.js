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
          Canvas: 'Software only, hardware acceleration unavailable',
          'Canvas out-of-process rasterization': 'Disabled',
          'Direct Rendering Display Compositor': 'Disabled',
          Compositing: 'Software only. Hardware acceleration disabled',
          'Multiple Raster Threads': 'Enabled',
          OpenGL: 'Disabled',
          Rasterization: 'Software only. Hardware acceleration disabled',
          'Raw Draw': 'Disabled',
          'Skia Graphite': 'Enabled',
          'Video Decode': 'Software only. Hardware acceleration disabled',
          'Video Encode': 'Software only. Hardware acceleration disabled',
          Vulkan: 'Disabled',
          WebGL: 'Software only, hardware acceleration unavailable',
          WebGL2: 'Software only, hardware acceleration unavailable',
          WebGPU: 'Disabled',
          WebNN: 'Disabled'
        }
      : {
          Canvas: 'Hardware accelerated',
          'Canvas out-of-process rasterization': 'Enabled',
          'Direct Rendering Display Compositor': 'Disabled',
          Compositing: 'Hardware accelerated',
          'Multiple Raster Threads': 'Enabled',
          OpenGL: 'Enabled',
          Rasterization: 'Hardware accelerated',
          'Raw Draw': 'Disabled',
          'Skia Graphite': 'Enabled',
          'Video Decode': 'Hardware accelerated',
          'Video Encode': 'Hardware accelerated',
          WebGL: 'Hardware accelerated',
          WebGL2: 'Hardware accelerated',
          WebGPU: 'Hardware accelerated',
          WebNN: 'Disabled'
        }
  )
})
