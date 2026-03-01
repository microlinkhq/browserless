'use strict'

const DEFAULT_WAIT_FOR_DOM = 0
const WAIT_FOR_DOM_IDLE_RATIO = 10

const resolveWaitForDom = waitForDom => {
  const timeout = Number.isFinite(waitForDom) && waitForDom >= 0 ? waitForDom : DEFAULT_WAIT_FOR_DOM

  if (timeout === 0) return undefined

  return {
    timeout,
    idle: timeout / WAIT_FOR_DOM_IDLE_RATIO
  }
}

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

module.exports = {
  DEFAULT_WAIT_FOR_DOM,
  WAIT_FOR_DOM_IDLE_RATIO,
  resolveWaitForDom,
  waitForDomStability
}
