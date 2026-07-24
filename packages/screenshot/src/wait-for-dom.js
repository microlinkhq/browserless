'use strict'

const waitForDomStability = ({ idle, timeout } = {}) =>
  new Promise(resolve => {
    if (!document.body) return resolve({ status: 'no-body' })

    let lastChange = performance.now()
    const observer = new window.MutationObserver(() => {
      lastChange = performance.now()
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    })

    const deadline = performance.now() + timeout

    ;(function check () {
      const now = performance.now()
      if (now - lastChange >= idle) {
        observer.disconnect()
        return resolve({ status: 'idle' })
      }
      if (now >= deadline) {
        observer.disconnect()
        return resolve({ status: 'timeout' })
      }
      window.requestAnimationFrame(check)
    })()
  })

module.exports = { waitForDomStability }
