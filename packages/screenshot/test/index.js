'use strict'

const { getBrowserContext } = require('@browserless/test/util')
const cheerio = require('cheerio')
const isCI = require('is-ci')
const test = require('ava')

test('graphics features', async t => {
  const browserless = await getBrowserContext(t)

  const getGpu = browserless.withPage(page => async () => {
    await page.goto('chrome://gpu/')

    const html = await page.evaluate(() => document.querySelector('info-view').shadowRoot.innerHTML)
    await page.close()

    const $ = cheerio.load(html)

    const props = []

    $('.feature-status-list li').each(function () {
      props.push($(this).text().split(': '))
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
          'Multiple Raster Threads': 'Disabled',
          OpenGL: 'Disabled',
          Rasterization: 'Software only. Hardware acceleration disabled',
          'Raw Draw': 'Disabled',
          'Video Decode': 'Software only. Hardware acceleration disabled',
          'Video Encode': 'Software only. Hardware acceleration disabled',
          Vulkan: 'Disabled',
          WebGL: 'Software only, hardware acceleration unavailable',
          WebGL2: 'Software only, hardware acceleration unavailable',
          WebGPU: 'Disabled'
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
          'Video Decode': 'Hardware accelerated',
          'Video Encode': 'Hardware accelerated',
          Vulkan: 'Disabled',
          WebGL: 'Hardware accelerated',
          WebGL2: 'Hardware accelerated',
          WebGPU: 'Hardware accelerated'
        }
  )
})
