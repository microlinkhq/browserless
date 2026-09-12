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
 * Runs inside the `WORLD_NAME` isolated world: it shares the DOM with the page
 * but none of its JavaScript globals, so the page cannot observe its state or
 * its DOM queries.
 *
 * Re-invoking is idempotent (guarded by `window.__browserlessDismiss` inside
 * that world) and triggers a fresh scan, so the post-navigation `run` fallback
 * catches dialogs mounted after a slow `goto`, even once the observer has stopped.
 */
const dismissOverlays = () => {
  if (Object.prototype.hasOwnProperty.call(window, '__browserlessDismiss')) {
    window.__browserlessDismiss.rescan()
    return window.__browserlessDismiss.clicked
  }
  const state = (window.__browserlessDismiss = { clicked: 0 })

  /* Capture the builtins up front and `.call` them: HTMLFormElement named
     access lets a page shadow these on a `<form>` dialog or button (e.g.
     `<button name="querySelectorAll">`), and reading them off the element would
     throw. The isolated world's prototypes are out of the page's reach. */
  const { getClientRects, querySelector, querySelectorAll, getAttribute, closest } =
    window.Element.prototype
  const { click } = window.HTMLElement.prototype
  const innerText = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'innerText').get
  /* non-HTML elements (SVG, MathML) have no innerText, so they read as empty
     text, as `element.innerText` always did */
  const readText = el => (el instanceof window.HTMLElement ? innerText.call(el) : '')

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
    if (!getClientRects.call(el).length) return false
    const style = window.getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0'
  }

  const seen = new WeakSet()

  const dismiss = dialog => {
    if (CONSENT_TEXT.test(readText(dialog))) return false
    const hasFields = !!querySelector.call(dialog, 'input, select, textarea')
    const buttons = querySelectorAll.call(dialog, 'button, [role="button"], input[type="button"]')

    /* Single pass: defer the click so a reject button anywhere in the dialog
       still aborts it (leaving the opt-out to autoconsent), while
       acknowledge/close buttons are collected in order to click afterwards. */
    const candidates = []
    for (const button of buttons) {
      if (!isVisible(button) || button.disabled) continue
      const text = normalize(readText(button) || button.value)
      const label = normalize(getAttribute.call(button, 'aria-label'))
      if (REJECT_TEXT.test(text) || REJECT_TEXT.test(label)) return false
      const isClose = CLOSE_LABEL.test(label) && !closest.call(button, 'form')
      const isAcknowledge = !hasFields && ACK_TEXT.test(text)
      if (isAcknowledge || isClose) candidates.push(button)
    }
    /* a click only counts once it succeeds: a non-HTML candidate (an SVG close
       icon) cannot be clicked, so the next candidate gets its turn */
    for (const candidate of candidates) {
      try {
        click.call(candidate)
      } catch {
        continue
      }
      seen.add(dialog)
      state.clicked++
      return true
    }
    return false
  }

  const scan = () => {
    if (state.clicked >= MAX_CLICKS) return
    const dialogs = document.querySelectorAll(
      'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]'
    )
    for (const dialog of dialogs) {
      /* one hostile dialog must not abort the scan or every later rescan */
      try {
        if (seen.has(dialog) || !isVisible(dialog)) continue
        dismiss(dialog)
      } catch {}
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

const WORLD_NAME = 'browserless_dismiss'

const source = `(${dismissOverlays})()`

const STALE_CONTEXT_ERROR =
  /Cannot find context|navigated or closed|Execution context was destroyed/

const MAX_ATTEMPTS = 3

const pagesWithSetup = new WeakSet()

const evaluationError = ({ exception, text }) => new Error(exception?.description ?? text)

const evaluateInWorld = async page => {
  const client = page._client()
  const { executionContextId } = await client.send('Page.createIsolatedWorld', {
    frameId: page.mainFrame()._id,
    worldName: WORLD_NAME
  })
  return client.send('Runtime.evaluate', {
    expression: source,
    contextId: executionContextId,
    returnByValue: true
  })
}

/* A navigation between both CDP calls destroys the world, so it is resolved
   again on the new document. */
const evaluateWithRetry = async page => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await evaluateInWorld(page)
    } catch (error) {
      if (attempt === MAX_ATTEMPTS || !STALE_CONTEXT_ERROR.test(error.message)) throw error
    }
  }
}

/* Runs for documents where the DOMContentLoaded dismissal did not fire;
   `Page.createIsolatedWorld` returns the same named world either way, so the
   idempotency guard is shared with `setup`. The DOMContentLoaded dismissal is
   asynchronous: a navigation resolving at DOMContentLoaded can return before
   it clicks, so callers that need it settled await `run` afterwards. */
const run = async page => {
  const { result, exceptionDetails } = await evaluateWithRetry(page)
  if (exceptionDetails) throw evaluationError(exceptionDetails)
  const clicked = result.value
  if (clicked > 0) debug('clicked', { clicked })
  return clicked
}

/* `domcontentloaded` only fires for the main frame, and Puppeteer re-binds it
   when a prerender activation swaps the page to a new CDP session, so child
   frames never get a dismiss world and later navigations keep dismissing. */
const setup = async page => {
  if (pagesWithSetup.has(page)) return
  pagesWithSetup.add(page)
  page.on('domcontentloaded', () =>
    run(page).catch(error => debug('error', { message: error.message }))
  )
}

module.exports = { setup, run, WORLD_NAME }
