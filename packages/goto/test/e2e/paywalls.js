'use strict'

const test = require('ava')

const createBrowserless = require('browserless')
const { getDomain } = require('tldts')
const onExit = require('signal-exit')
const isCI = require('is-ci')

const browserless = createBrowserless({ timeout: 300000 })

onExit(browserless.destroy)
;[
  !isCI && 'https://www.washingtonpost.com/nation/2020/06/25/coronavirus-live-updates-us/',
  'https://www.wsj.com/articles/unilever-to-halt-u-s-ads-on-facebook-and-twitter-for-rest-of-2020-11593187230',
  'https://www.thestar.com/news/gta/2020/06/26/judgment-in-dafonte-miller-beating-case-to-be-streamed-live-friday-morning.html',
  'https://medium.com/@rakyll/things-i-wished-more-developers-knew-about-databases-2d0178464f78',
  'https://www.theglobeandmail.com/canada/article-off-duty-toronto-police-officer-found-guilty-of-assaulting-black-teen/',
  !isCI && 'https://www.ft.com/content/37ae69d9-f160-48c3-b3c5-736730c110ce',
  'https://elpais.com/sociedad/2020-06-27/el-reino-unido-levantara-el-6-de-julio-la-cuarentena-a-los-viajeros-procedentes-de-espana.html'
]
  .filter(Boolean)
  .forEach(url => {
    test(getDomain(url), async t => {
      const getDescription = browserless.evaluate(page =>
        page.evaluate(() => {
          const el = document.querySelector('meta[property="og:description"]')
          return {
            html: document.documentElement.innerHTML,
            description: el ? el.content : ''
          }
        })
      )

      const { html, description } = await getDescription(url)

      t.true(!!description, html)
      t.snapshot(description)
    })
  })
