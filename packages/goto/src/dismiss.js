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
 *  - dialogs exposing a reject-style button ("Reject all", "Decline",
 *    "Ablehnen", "Tout refuser", "Rechazar"...) are left untouched even
 *    without consent copy, so a CMP is never acknowledged as "accept"
 *    before autoconsent opts out; the reject vocabulary is multilingual.
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
  /* reject-style buttons across the languages browserless screenshots most:
     a match means a reject/opt-out choice exists, so dismiss steps aside and
     lets autoconsent make it. Enumerated (not stemmed) to stay precise; a
     false positive only makes dismiss a no-op, never a wrong click. */
  const REJECT_WORDS = [
    /* English */
    'reject( all)?( cookies)?',
    'decline( all)?( cookies)?',
    'deny( all)?( cookies)?',
    'refuse( all)?( cookies)?',
    'disagree',
    'continue without accepting',
    'necessary only',
    'only necessary( cookies)?',
    'essential only',
    'only essential( cookies)?',
    /* German */
    '(alle |auswahl )?ablehnen',
    'nur (notwendige|erforderliche|essenzielle)( cookies)?',
    /* French */
    'refuser( tout)?',
    'tout refuser',
    'continuer sans accepter',
    /* Spanish */
    'rechazar( todo| todas)?',
    's[oó]lo( las)? necesarias',
    /* Italian */
    'rifiuta( tutto| tutti)?',
    'continua senza accettare',
    'solo( i)? necessari',
    /* Portuguese */
    'rejeitar( tudo)?',
    'recusar( tudo)?',
    'apenas( os)? (essenciais|necess[aá]rios)',
    /* Dutch */
    '(alles )?weigeren',
    'alleen (noodzakelijke|essenti[eë]le)( cookies)?',
    /* Polish */
    'odrzu[cć]( wszystko| wszystkie)?',
    'tylko niezb[eę]dne'
  ]
  const REJECT_TEXT = new RegExp(`^(${REJECT_WORDS.join('|')})$`)
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

    /* Single pass: defer the click so a reject button anywhere in the dialog
       still aborts it (leaving the opt-out to autoconsent), while the first
       acknowledge/close button becomes the candidate to click if none appears. */
    let candidate = null
    for (const button of buttons) {
      if (!isVisible(button) || button.disabled) continue
      const text = normalize(button.innerText || button.value)
      const label = normalize(button.getAttribute('aria-label'))
      if (REJECT_TEXT.test(text) || REJECT_TEXT.test(label)) return false
      if (!candidate) {
        const isClose = CLOSE_LABEL.test(label) && !button.closest('form')
        const isAcknowledge = !hasFields && ACK_TEXT.test(text)
        if (isAcknowledge || isClose) candidate = button
      }
    }
    if (!candidate) return false
    seen.add(dialog)
    state.clicked++
    candidate.click()
    return true
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
