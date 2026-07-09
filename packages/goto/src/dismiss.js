'use strict'

const debug = require('debug-logfmt')('browserless:goto:dismiss')

/**
 * Dismiss generic announcement/interstitial dialogs that cookie-consent
 * tooling (autoconsent) does not cover: modals with no consent language and
 * a single acknowledge-style button (e.g. "I understand", "Got it", "OK").
 *
 * Scope is deliberately narrow to avoid false positives:
 *  - only ARIA dialogs (`role="dialog"`, `role="alertdialog"`, `aria-modal`,
 *    `<dialog open>`), never arbitrary fixed-position elements.
 *  - dialogs whose copy mentions cookies/consent/privacy are left untouched
 *    so autoconsent owns the opt-out decision (never clicked as "accept").
 *  - dialogs containing form fields are skipped, except for an explicit
 *    close button (`aria-label="close"`) outside a form.
 *  - only buttons, never anchors, so a click cannot navigate.
 *
 * Re-invoking is idempotent (guarded by `window.__browserlessDismiss`) and
 * triggers a fresh scan, so the post-navigation `run` fallback catches
 * dialogs mounted after a slow `goto`, even once the observer has stopped.
 */
const dismissOverlays = () => {
  if (window.self !== window.top) return 0
  if (window.__browserlessDismiss) {
    window.__browserlessDismiss.rescan()
    return window.__browserlessDismiss.clicked
  }
  const state = (window.__browserlessDismiss = { clicked: 0 })

  const MAX_CLICKS = 3
  const WATCH_MS = 15000
  const ACK_TEXT = /^(ok(ay)?|got it|i understand|understood|dismiss|close|continue|x|×|✕)$/
  const CLOSE_LABEL = /^(close|dismiss)( \S+){0,3}$/
  /* consent copy: leave these dialogs to autoconsent's opt-out flow */
  const CONSENT_TEXT =
    /\b(cookies?|consent|gdpr|ccpa|privacy|data protection|personali[sz]ed? ads|tracking technolog)/i

  const normalize = text =>
    (text || '')
      .replace(/\s+/g, ' ')
      .replace(/[!.]+$/, '')
      .trim()
      .toLowerCase()

  const isVisible = el => {
    if (!el.getClientRects().length) return false
    const style = window.getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0'
  }

  const seen = new WeakSet()

  const dismiss = dialog => {
    if (CONSENT_TEXT.test(dialog.innerText || '')) return false
    const hasFields = !!dialog.querySelector('input, select, textarea')
    const buttons = dialog.querySelectorAll('button, [role="button"], input[type="button"]')

    for (const button of buttons) {
      if (!isVisible(button) || button.disabled) continue
      const text = normalize(button.innerText || button.value)
      const label = normalize(button.getAttribute('aria-label'))
      const isClose = CLOSE_LABEL.test(label) && !button.closest('form')
      const isAcknowledge = !hasFields && ACK_TEXT.test(text)
      if (isAcknowledge || isClose) {
        seen.add(dialog)
        state.clicked++
        button.click()
        return true
      }
    }
    return false
  }

  const scan = () => {
    if (state.clicked >= MAX_CLICKS) return
    const dialogs = document.querySelectorAll(
      'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]'
    )
    for (const dialog of dialogs) {
      if (seen.has(dialog) || !isVisible(dialog)) continue
      dismiss(dialog)
      if (state.clicked >= MAX_CLICKS) return
    }
  }
  state.rescan = scan

  let timer
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(scan, 150)
  }

  const observer = new window.MutationObserver(schedule)

  const start = () => {
    scan()
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role', 'aria-modal', 'open', 'style', 'class']
    })
    setTimeout(() => {
      observer.disconnect()
      clearTimeout(timer)
    }, WATCH_MS)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }

  return state.clicked
}

const setup = page => page.evaluateOnNewDocument(dismissOverlays)

/* Re-run for documents where the new-document injection did not fire;
   the script is idempotent (guarded by `window.__browserlessDismiss`). */
const run = page =>
  page.evaluate(dismissOverlays).then(clicked => {
    if (clicked > 0) debug('clicked', { clicked })
    return clicked
  })

module.exports = { setup, run }
