'use strict'

const { getBrowserContext, runServer } = require('@browserless/test')
const sharp = require('sharp')
const { default: test } = require('ava')

const createScreenshot = require('..')

const DOCUMENT_HEIGHT = 5000
const BANNER_CLOSE_MS = 800
const BANNER_TRIGGER_PX = 2000
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

test('a consent banner that opens on scroll is handled before a full page capture', async t => {
  const url = await runServer(t, ({ req, res }) => {
    if (req.url === '/consent-message') {
      setTimeout(() => res.end('{}'), MESSAGE_RESPONSE_MS)
      return
    }
    res.setHeader('content-type', 'text/html')
    res.end(html)
  })

  const browserless = await getBrowserContext(t)
  const { png, choice, bannerShown } = await browserless.withPage((page, goto) => async () => {
    const png = await createScreenshot({ goto })(page)(url, { fullPage: true, timeout: 30000 })
    const state = await page.evaluate(() => ({
      choice: window.consentChoice,
      bannerShown: !!document.querySelector('ytd-consent-bump-v2-lightbox')
    }))
    return { png, ...state }
  })()

  const { height, data, info } = await sharp(png)
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => ({ height: info.height, data, info }))
  const dpr = info.width / 1280
  const topPixel = [data[0], data[1], data[2]]

  t.is(choice, 'decline')
  t.false(bannerShown)
  t.true(
    height >= DOCUMENT_HEIGHT * dpr,
    `captured ${height}px of a ${DOCUMENT_HEIGHT * dpr}px document`
  )
  t.deepEqual(topPixel, [200, 0, 0])
})
