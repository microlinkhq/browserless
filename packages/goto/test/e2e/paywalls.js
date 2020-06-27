'use strict'

const test = require('ava')

const createBrowserless = require('browserless')
const { getDomain } = require('tldts')
const isCI = require('is-ci')

;[
  'https://www.washingtonpost.com/nation/2020/06/25/coronavirus-live-updates-us/',
  'https://www.wsj.com/articles/unilever-to-halt-u-s-ads-on-facebook-and-twitter-for-rest-of-2020-11593187230',
  'https://www.thestar.com/news/gta/2020/06/26/judgment-in-dafonte-miller-beating-case-to-be-streamed-live-friday-morning.html',
  'https://medium.com/@rakyll/things-i-wished-more-developers-knew-about-databases-2d0178464f78',
  'https://www.theglobeandmail.com/canada/article-off-duty-toronto-police-officer-found-guilty-of-assaulting-black-teen/',
  !isCI && 'https://www.ft.com/content/80708a7e-bbba-4c19-b3e0-a4b1d49e2b85',
  'https://elpais.com/sociedad/2020-06-27/el-reino-unido-levantara-el-6-de-julio-la-cuarentena-a-los-viajeros-procedentes-de-espana.html'
]
  .filter(Boolean)
  .forEach(url => {
    test(getDomain(url), async t => {
      const browserless = createBrowserless()
      const getDescription = browserless.evaluate(page =>
        page.evaluate(() => document.querySelector('meta[property="og:description"]').content)
      )

      const description = await getDescription(url)

      t.true(!!description)
      t.snapshot(description)
    })
  })
