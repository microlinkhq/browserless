'use strict'

const { getBrowserContext, runServer } = require('@browserless/test')
const { default: test } = require('ava')

const { prepareFullDocument } = require('../src/prepare-full-document')

const DOCUMENT_HEIGHT = 7000
const BANNER_CLOSE_MS = 800
const BANNER_TRIGGER_PX = 900
const MESSAGE_RESPONSE_MS = 50

const html = `<!doctype html>
<html>
  <body style="margin:0">
    <div style="height:300px;background:rgb(200,0,0)">top of the page</div>
    <div style="height:${DOCUMENT_HEIGHT - 300}px;background:rgb(0,0,200)">rest of the page</div>
    <script>
      const lock = () => {
        const top = window.scrollY
        document.body.style.cssText = 'margin:0;position:fixed;width:100%;top:' + -top + 'px'
        return () => {
          document.body.style.cssText = 'margin:0'
          window.scrollTo(0, top)
        }
      }
      const showBanner = () => {
        const unlock = lock()
        document.body.insertAdjacentHTML('beforeend', \`
          <ytd-consent-bump-v2-lightbox style="position:fixed;inset:0;display:block;background:rgba(0,0,0,.6)">
            <tp-yt-paper-dialog style="display:block;width:600px;margin:80px auto;padding:24px;background:#fff">
              <p>Before you continue</p>
              <a href="https://consent.youtube.com/d">More options</a>
              <div class="eom-buttons">
                <div class="eom-button-row">
                  <ytd-button-renderer><button id="decline">Nope</button></ytd-button-renderer>
                  <ytd-button-renderer><button id="accept">Accept all</button></ytd-button-renderer>
                </div>
              </div>
            </tp-yt-paper-dialog>
          </ytd-consent-bump-v2-lightbox>\`)
        const banner = document.querySelector('ytd-consent-bump-v2-lightbox')
        for (const button of banner.querySelectorAll('button')) {
          button.addEventListener('click', () => {
            window.consentChoice = button.id
            setTimeout(() => { banner.remove(); unlock() }, ${BANNER_CLOSE_MS})
          })
        }
      }
      const onScroll = () => {
        if (window.scrollY < ${BANNER_TRIGGER_PX}) return
        window.removeEventListener('scroll', onScroll)
        fetch('/consent-message').then(() => showBanner())
      }
      window.addEventListener('scroll', onScroll)
    </script>
  </body>
</html>`

test.serial(
  'a consent banner that opens during the full-document scroll is closed and the page unlocked',
  async t => {
    const url = await runServer(t, ({ req, res }) => {
      if (req.url === '/consent-message') {
        setTimeout(() => res.end('{}'), MESSAGE_RESPONSE_MS)
        return
      }
      res.setHeader('content-type', 'text/html')
      res.end(html)
    })

    const browserless = await getBrowserContext(t)
    const state = await browserless.withPage((page, goto) => async () => {
      await goto(page, { url, waitUntil: 'load', timeout: 30000 })
      await prepareFullDocument(page, { goto, timeout: 30000 })
      return page.evaluate(() => ({
        choice: window.consentChoice,
        bannerShown: !!document.querySelector('ytd-consent-bump-v2-lightbox'),
        bodyPosition: window.getComputedStyle(document.body).position,
        documentHeight: document.documentElement.scrollHeight,
        scrollY: window.scrollY
      }))
    })()

    t.is(state.choice, 'decline')
    t.false(state.bannerShown)
    t.is(state.bodyPosition, 'static')
    t.true(state.documentHeight >= DOCUMENT_HEIGHT, `document is ${state.documentHeight}px`)
    t.is(state.scrollY, 0)
  }
)
