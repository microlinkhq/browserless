'use strict'

const GREASE_CHARS = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_']
const GREASE_VERSIONS = ['8', '99', '24']
const BRAND_ORDERS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0]
]

const MAC_PLATFORM_VERSION = '26.6.2'
const MAC_ARCHITECTURE = { architecture: 'arm', bitness: '64' }
const LINUX_PLATFORM_VERSION = ''
const WINDOWS_PLATFORM_VERSIONS = { '10.0': '19.0.0', 6.3: '0.3.0', 6.2: '0.2.0', 6.1: '0.1.0' }

const CHROME_USER_AGENT =
  /\(KHTML, like Gecko\) (?:Version\/[\d.]+ )?Chrome\/((\d+)\.[\d.]+) (?:Mobile )?Safari\/[\d.]+$/
const REDUCED_VERSION = /^\d+\.0\.0\.0$/
const ANDROID_WEBVIEW = /; wv\)/

const toPlatformVersion = version => {
  const parts = version.split(/[._]/)
  while (parts.length < 3) parts.push('0')
  return parts.slice(0, 3).join('.')
}

const toArchitecture = arch => {
  if (/aarch64|arm64/i.test(arch)) return { architecture: 'arm', bitness: '64' }
  if (/arm/i.test(arch)) return { architecture: 'arm', bitness: '32' }
  if (/i[36]86/.test(arch)) return { architecture: 'x86', bitness: '32' }
  return { architecture: 'x86', bitness: '64' }
}

const desktop = (platform, navigatorPlatform, platformVersion, architecture) => ({
  navigatorPlatform,
  platform,
  platformVersion,
  ...architecture,
  model: '',
  mobile: false,
  wow64: false,
  formFactors: ['Desktop']
})

const detectPlatform = userAgent => {
  const android = userAgent.match(/Android (\d+(?:\.\d+)*)(?:; ([^;)]+))?/)
  if (android) {
    const mobile = /\bMobile\b/.test(userAgent)
    return {
      navigatorPlatform: 'Linux armv81',
      platform: 'Android',
      platformVersion: toPlatformVersion(android[1]),
      architecture: '',
      bitness: '',
      model: (android[2] || '').replace(/ Build\/.*$/, '').trim(),
      mobile,
      wow64: false,
      formFactors: [mobile ? 'Mobile' : 'Tablet']
    }
  }

  const chromeOS = userAgent.match(/CrOS (\S+) ([\d.]+)/)
  if (chromeOS) {
    return desktop(
      'Chrome OS',
      `Linux ${chromeOS[1]}`,
      toPlatformVersion(chromeOS[2]),
      toArchitecture(chromeOS[1])
    )
  }

  const windows = userAgent.match(/Windows NT (\d+\.\d+)/)
  if (windows) {
    return {
      ...desktop(
        'Windows',
        'Win32',
        WINDOWS_PLATFORM_VERSIONS[windows[1]] ?? '0.0.0',
        toArchitecture(userAgent)
      ),
      ...(/WOW64/.test(userAgent) ? { bitness: '32', wow64: true } : {})
    }
  }

  if (/Macintosh/.test(userAgent)) {
    return desktop('macOS', 'MacIntel', MAC_PLATFORM_VERSION, MAC_ARCHITECTURE)
  }

  const linux = userAgent.match(/Linux (\w+)/)
  if (linux) {
    return desktop('Linux', `Linux ${linux[1]}`, LINUX_PLATFORM_VERSION, toArchitecture(linux[1]))
  }

  return undefined
}

const greaseBrand = major => ({
  brand: `Not${GREASE_CHARS[major % GREASE_CHARS.length]}A${
    GREASE_CHARS[(major + 1) % GREASE_CHARS.length]
  }Brand`,
  version: GREASE_VERSIONS[major % GREASE_VERSIONS.length]
})

const orderBrands = (major, [grease, chromium, chrome]) => {
  const order = BRAND_ORDERS[major % BRAND_ORDERS.length]
  const brands = []
  brands[order[0]] = grease
  brands[order[1]] = chromium
  brands[order[2]] = chrome
  return brands
}

const getClientHints = (userAgent, browserVersion) => {
  const chrome = userAgent?.match(CHROME_USER_AGENT)
  if (!chrome) return {}

  const device = detectPlatform(userAgent)
  if (!device) return {}

  const [, userAgentVersion, majorVersion] = chrome
  const major = Number(majorVersion)
  const fullVersion =
    REDUCED_VERSION.test(userAgentVersion) && browserVersion?.startsWith(`${major}.`)
      ? browserVersion
      : userAgentVersion
  const grease = greaseBrand(major)
  const brand = ANDROID_WEBVIEW.test(userAgent) ? 'Android WebView' : 'Google Chrome'
  const { navigatorPlatform, ...metadata } = device

  return {
    platform: navigatorPlatform,
    userAgentMetadata: {
      brands: orderBrands(major, [
        grease,
        { brand: 'Chromium', version: majorVersion },
        { brand, version: majorVersion }
      ]),
      fullVersionList: orderBrands(major, [
        { brand: grease.brand, version: `${grease.version}.0.0.0` },
        { brand: 'Chromium', version: fullVersion },
        { brand, version: fullVersion }
      ]),
      fullVersion,
      ...metadata
    }
  }
}

module.exports = { getClientHints }
