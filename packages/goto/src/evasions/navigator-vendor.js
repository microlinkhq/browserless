module.exports = page =>
  page.evaluateOnNewDocument(async () => {
    const getUserAgentVendor = userAgent => {
      let vendor

      if (userAgent.includes('Firefox')) {
        vendor = 'firefox'
      } else if (userAgent.includes('Chrome')) {
        vendor = 'chrome'
      } else {
        vendor = 'safari'
      }

      return vendor
    }

    const userAgent = navigator.userAgent
    const userAgentVendor = getUserAgentVendor(userAgent)

    if (userAgentVendor === 'chrome') return

    Object.defineProperty(navigator, 'vendor', {
      value: userAgentVendor === 'safari' ? 'Apple Computer, Inc.' : ''
    })
  })
