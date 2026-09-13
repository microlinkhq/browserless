'use strict'

const test = require('ava')

const createGetDevice = require('..')

test('undefined as default', t => {
  const getDevice = createGetDevice()

  t.deepEqual(getDevice(), {
    userAgent: undefined,
    viewport: undefined
  })
})

test('support user agent from headers', t => {
  const getDevice = createGetDevice()

  t.deepEqual(getDevice({ headers: { 'user-agent': 'googlebot' } }), {
    userAgent: 'googlebot',
    viewport: undefined
  })
})

test('unify user agent from device', t => {
  const getDevice = createGetDevice()
  const device = getDevice({ device: 'iPad' })

  t.deepEqual(getDevice({ device: 'iPad', headers: { 'user-agent': 'googlebot' } }), {
    userAgent: device.userAgent,
    viewport: device.viewport
  })
})

test('support lossy device name', t => {
  const getDevice = createGetDevice({ lossyDeviceName: true })
  const device = getDevice({ device: 'Macbook Pro 13' })

  t.deepEqual(getDevice(), { userAgent: undefined, viewport: undefined })
  t.deepEqual(getDevice({ device: 'macbook pro 13' }), device)
  t.deepEqual(getDevice({ device: 'MACBOOK PRO 13' }), device)
  t.deepEqual(getDevice({ device: 'macbook pro' }), device)
  t.deepEqual(getDevice({ device: 'macboo pro' }), device)
})

test('aligns Chrome user agents with the installed Puppeteer', t => {
  const chromeVersion = '149.0.7827.22'
  const getDevice = createGetDevice({
    puppeteer: {
      PUPPETEER_REVISIONS: { chrome: chromeVersion },
      KnownDevices: {
        'Galaxy S8': {
          name: 'Galaxy S8',
          userAgent:
            'Mozilla/5.0 (Linux; Android 7.0; SM-G950U Build/NRD90M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.84 Mobile Safari/537.36',
          viewport: { width: 360, height: 740 }
        },
        'iPhone 13': {
          name: 'iPhone 13',
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
          viewport: { width: 390, height: 844 }
        }
      }
    }
  })

  t.is(getDevice.chromeVersion, chromeVersion)
  t.is(
    getDevice({ device: 'Macbook Pro 13' }).userAgent,
    createGetDevice.desktopUserAgent(chromeVersion)
  )
  t.true(getDevice({ device: 'Galaxy S8' }).userAgent.includes(`Chrome/${chromeVersion}`))
  t.false(getDevice({ device: 'iPhone 13' }).userAgent.includes('Chrome/'))
})

test('the desktop user agent follows the host operating system', t => {
  const chromeVersion = '152.0.7977.83'
  const { desktopUserAgent, hostDesktopPlatform } = createGetDevice
  const asUserAgent = platform =>
    `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`

  t.is(
    desktopUserAgent(chromeVersion, hostDesktopPlatform('darwin')),
    asUserAgent('Macintosh; Intel Mac OS X 10_15_7')
  )
  t.is(
    desktopUserAgent(chromeVersion, hostDesktopPlatform('win32')),
    asUserAgent('Windows NT 10.0; Win64; x64')
  )
  t.is(
    desktopUserAgent(chromeVersion, hostDesktopPlatform('linux')),
    asUserAgent('X11; Linux x86_64')
  )
  t.is(hostDesktopPlatform('freebsd'), hostDesktopPlatform('linux'))
  t.is(desktopUserAgent(chromeVersion), asUserAgent(hostDesktopPlatform(process.platform)))
})

test('the Linux platform token stays frozen on every architecture', t => {
  const { hostDesktopPlatform } = createGetDevice

  t.is(hostDesktopPlatform('linux'), 'X11; Linux x86_64')
  t.is(hostDesktopPlatform('freebsd'), 'X11; Linux x86_64')
  t.false(hostDesktopPlatform('linux').includes('aarch64'))
  t.is(hostDesktopPlatform('darwin'), 'Macintosh; Intel Mac OS X 10_15_7')
  t.is(hostDesktopPlatform('win32'), 'Windows NT 10.0; Win64; x64')
})

test('the default device advertises the host operating system', t => {
  const getDevice = createGetDevice()
  const { userAgent } = getDevice({ device: 'Macbook Pro 13' })

  t.is(userAgent, createGetDevice.desktopUserAgent(getDevice.chromeVersion))
  t.true(userAgent.includes(createGetDevice.hostDesktopPlatform(process.platform)))
})

test('does not ship a frozen Chrome 62 user agent', t => {
  const getDevice = createGetDevice()
  const { userAgent } = getDevice({ device: 'Macbook Pro 13' })

  t.true(userAgent.includes(`Chrome/${getDevice.chromeVersion}`))
  t.false(userAgent.includes('Chrome/62'))
  t.false(userAgent.includes('10_12_6'))
})
