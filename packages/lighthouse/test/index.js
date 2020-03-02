'use strict'

const pMemoize = require('p-memoize')

const test = require('ava')

const getStats = require('..')

const memStats = pMemoize(getStats)

test('default audits', async t => {
  const url = 'https://kikobeats.com'
  const insights = await memStats(url)

  t.snapshot(Object.keys(insights))
})

test('all audits include title and description', async t => {
  const url = 'https://kikobeats.com'
  const insights = await memStats(url)

  Object.keys(insights).forEach(key => {
    t.true(!isNil(insights[key].title))
    t.true(!isNil(insights[key].description))
  })
})

const isNil = value => value == null

test('duration + duration_pretty', async t => {
  const url = 'https://kikobeats.com'
  const insights = await memStats(url)

  t.true(!isNil(insights['first-contentful-paint'].duration))
  t.true(!isNil(insights['first-contentful-paint'].duration_pretty))

  t.true(!isNil(insights['first-meaningful-paint'].duration))
  t.true(!isNil(insights['first-meaningful-paint'].duration_pretty))

  t.true(!isNil(insights['speed-index'].duration))
  t.true(!isNil(insights['speed-index'].duration_pretty))

  t.true(!isNil(insights['estimated-input-latency'].duration))
  t.true(!isNil(insights['estimated-input-latency'].duration_pretty))

  t.true(!isNil(insights['total-blocking-time'].duration))
  t.true(!isNil(insights['total-blocking-time'].duration_pretty))

  t.true(!isNil(insights['max-potential-fid'].duration))
  t.true(!isNil(insights['max-potential-fid'].duration_pretty))

  t.true(!isNil(insights['time-to-first-byte'].duration))
  t.true(!isNil(insights['time-to-first-byte'].duration_pretty))

  t.true(!isNil(insights['first-cpu-idle'].duration))
  t.true(!isNil(insights['first-cpu-idle'].duration_pretty))

  t.true(!isNil(insights.interactive.duration))
  t.true(!isNil(insights.interactive.duration_pretty))

  t.true(!isNil(insights['bootup-time'].duration))
  t.true(!isNil(insights['bootup-time'].duration_pretty))
  insights['bootup-time'].details.items.forEach(item => {
    t.true(!isNil(item.duration))
    t.true(!isNil(item.duration_pretty))
    t.true(!isNil(item.script))
    t.true(!isNil(item.script_pretty))
    t.true(!isNil(item.parse))
    t.true(!isNil(item.parse_pretty))
  })

  t.true(!isNil(insights['network-server-latency'].duration))
  t.true(!isNil(insights['network-server-latency'].duration_pretty))
  insights['network-server-latency'].details.items.forEach(item => {
    t.true(!isNil(item.duration))
    t.true(!isNil(item.duration_pretty))
  })

  t.true(!isNil(insights['network-rtt'].duration))
  t.true(!isNil(insights['network-rtt'].duration_pretty))
  insights['network-rtt'].details.items.forEach(item => {
    t.true(!isNil(item.duration))
    t.true(!isNil(item.duration_pretty))
  })

  t.true(!isNil(insights['uses-rel-preconnect'].duration))
  t.true(!isNil(insights['uses-rel-preconnect'].duration_pretty))
  insights['uses-rel-preconnect'].details.items.forEach(item => {
    t.true(!isNil(item.duration))
    t.true(!isNil(item.duration_pretty))
  })

  t.true(!isNil(insights['first-meaningful-paint'].duration_pretty))
  t.true(!isNil(insights['speed-index'].duration_pretty))

  t.true(!isNil(insights['estimated-input-latency'].duration_pretty))
  t.true(!isNil(insights['total-blocking-time'].duration_pretty))
  t.true(!isNil(insights['max-potential-fid'].duration_pretty))
  t.true(!isNil(insights['time-to-first-byte'].duration_pretty))
  t.true(!isNil(insights['first-cpu-idle'].duration_pretty))
  t.true(!isNil(insights.interactive.duration_pretty))
})

test('timing + timing_pretty', async t => {
  const url = 'https://kikobeats.com'
  const insights = await memStats(url)
  insights['screenshot-thumbnails'].details.items.forEach(item => {
    t.true(!isNil(item.timing))
    t.true(!isNil(item.timing_pretty))
  })
})

test('score', async t => {
  const url = 'https://kikobeats.com'
  const insights = await memStats(url)

  t.true(!isNil(insights['first-contentful-paint'].score))
  t.true(!isNil(insights['first-meaningful-paint'].score))
  t.true(!isNil(insights['speed-index'].score))
  t.true(!isNil(insights['estimated-input-latency'].score))
  t.true(!isNil(insights['total-blocking-time'].score))
  t.true(!isNil(insights['max-potential-fid'].score))
  t.true(!isNil(insights['time-to-first-byte'].score))
  t.true(!isNil(insights['first-cpu-idle'].score))
  t.true(!isNil(insights.interactive.score))
  t.true(!isNil(insights['uses-rel-preload'].score))
  t.true(!isNil(insights['uses-rel-preconnect'].score))
  t.true(!isNil(insights['dom-size'].score))
  t.true(!isNil(insights['uses-http2'].score))
  t.true(!isNil(insights['meta-description'].score))
})

test('size + size_pretty', async t => {
  const url = 'https://kikobeats.com'
  const insights = await memStats(url)
  const resourceSummary = insights['resource-summary']

  Object.keys(resourceSummary.details).forEach(key => {
    t.true(!isNil(resourceSummary.details[key].size))
    t.true(!isNil(resourceSummary.details[key].size_pretty))
  })
})
