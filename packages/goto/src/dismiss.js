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
  const {
    getBoundingClientRect,
    getClientRects,
    querySelector,
    querySelectorAll,
    getAttribute,
    closest
  } = window.Element.prototype
  const { click } = window.HTMLElement.prototype
  const parentElement = Object.getOwnPropertyDescriptor(window.Node.prototype, 'parentElement').get
  const nodeData = Object.getOwnPropertyDescriptor(window.CharacterData.prototype, 'data').get
  const { createTreeWalker } = window.Document.prototype
  const { nextNode } = window.TreeWalker.prototype
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
  /* notification/push opt-in prompts render as bare overlays with no dialog
     role, so they are recognised by the prompt's own copy plus an explicit
     dismissive control; an affirmative control is never part of the vocabulary */
  const NOTIFICATION_TEXT =
    /(notification|notificaci|notificaç|benachrichtigung|notifich|meldingen|powiadomie|push)/i
  const NOTIFICATION_DISMISS_WORDS = [
    /* English */
    'no',
    'no,? thanks',
    'no,? thank you',
    'not now',
    'not right now',
    'maybe later',
    'later',
    'don.?t allow',
    'block',
    'deny',
    'never',
    /* Spanish */
    'no permitir',
    'ahora no',
    'm[aá]s tarde',
    'quiz[aá]s m[aá]s tarde',
    'no,? gracias',
    'bloquear',
    /* German */
    'nein,? danke',
    'nicht jetzt',
    'nicht zulassen',
    'sp[aä]ter',
    'vielleicht sp[aä]ter',
    'blockieren',
    'ablehnen',
    /* French */
    'non,? merci',
    'pas maintenant',
    'plus tard',
    'peut-[eê]tre plus tard',
    'bloquer',
    'refuser',
    /* Italian */
    'no,? grazie',
    'non ora',
    'pi[uù] tardi',
    'forse pi[uù] tardi',
    'blocca',
    /* Portuguese */
    'n[aã]o,? obrigad[oa]',
    'agora n[aã]o',
    'mais tarde',
    /* Dutch */
    'nee,? bedankt',
    'niet nu',
    'blokkeren',
    /* Polish */
    'nie,? dzi[eę]kuj[eę]',
    'nie teraz',
    'p[oó][zź]niej',
    'zablokuj',
    /* close affordances */
    'x',
    '×',
    '✕',
    '✖',
    'close',
    'cerrar',
    'schlie[sß]+en',
    'fermer',
    'chiudi',
    'sluiten',
    'fechar',
    'zamknij'
  ]
  const NOTIFICATION_DISMISS_TEXT = new RegExp(`^(${NOTIFICATION_DISMISS_WORDS.join('|')})$`)
  const PROMPT_LABEL_MAX = 32
  const PROMPT_TEXT_MAX = 400
  const PROMPT_VIEWPORT_RATIO_MAX = 0.4
  const PROMPT_DEPTH_MAX = 6

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

  const isPositioned = element => {
    const { position } = window.getComputedStyle(element)
    return position === 'fixed' || position === 'absolute' || position === 'sticky'
  }

  /* the first positioned ancestor is often an action row rather than the
     overlay, so every positioned ancestor is tried until one reads as a prompt */
  const promptOf = control => {
    let element = control
    for (let depth = 0; depth < PROMPT_DEPTH_MAX; depth++) {
      const parent = parentElement.call(element)
      if (!parent || parent === document.body) return undefined
      element = parent
      if (seen.has(element)) return undefined
      if (isPositioned(element) && isPrompt(element)) return element
    }
    return undefined
  }

  const isPrompt = container => {
    if (!isVisible(container)) return false
    if (querySelector.call(container, 'input, select, textarea')) return false
    const { width, height } = getBoundingClientRect.call(container)
    /* a container still waiting for layout measures 0x0, which would read as
       comfortably below the viewport ratio */
    if (width <= 0 || height <= 0) return false
    const viewport = window.innerWidth * window.innerHeight
    if (width * height > viewport * PROMPT_VIEWPORT_RATIO_MAX) return false
    const text = normalize(readText(container))
    if (text.length > PROMPT_TEXT_MAX) return false
    return NOTIFICATION_TEXT.test(text) && !CONSENT_TEXT.test(text)
  }

  /* the prompt's own copy holds words from the dismiss vocabulary ("no",
     "later"), so a match is only a control when it is one: a real control
     element, or something the page paints as clickable */
  const isControl = element =>
    !!closest.call(element, 'button, [role="button"], input[type="button"], summary') ||
    window.getComputedStyle(element).cursor === 'pointer'

  const dismissPrompt = control => {
    if (!isVisible(control) || !isControl(control) || closest.call(control, 'a[href]')) return false
    const { width, height } = getBoundingClientRect.call(control)
    if (width <= 0 || height <= 0) return false
    const prompt = promptOf(control)
    if (!prompt) return false
    try {
      click.call(control)
    } catch {
      return false
    }
    seen.add(prompt)
    state.clicked++
    return true
  }

  /* text nodes are walked instead of elements, and anything longer than a
     control label is skipped before it reaches a regexp, so the pass stays
     flat on a large DOM */
  const scanPrompts = () => {
    if (!document.body) return
    const walker = createTreeWalker.call(document, document.body, window.NodeFilter.SHOW_TEXT)
    for (let node = nextNode.call(walker); node; node = nextNode.call(walker)) {
      /* one hostile node must not abort the scan or every later rescan */
      try {
        const data = nodeData.call(node)
        if (!data || data.length > PROMPT_LABEL_MAX) continue
        if (!NOTIFICATION_DISMISS_TEXT.test(normalize(data))) continue
        const control = parentElement.call(node)
        if (control) dismissPrompt(control)
      } catch {}
      if (state.clicked >= MAX_CLICKS) return
    }
    for (const labelled of querySelectorAll.call(document.body, '[aria-label]')) {
      try {
        if (!NOTIFICATION_DISMISS_TEXT.test(normalize(getAttribute.call(labelled, 'aria-label')))) {
          continue
        }
        dismissPrompt(labelled)
      } catch {}
      if (state.clicked >= MAX_CLICKS) return
    }
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
    scanPrompts()
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
