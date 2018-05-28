'use strict'

const isTrackingDomain = require('is-tracking-domain')

const WHITELIST_RESOURCE_DOMAINS = ['twimg.com', 'adobe.com']

module.exports = domain =>
  isTrackingDomain(domain, { exclude: WHITELIST_RESOURCE_DOMAINS })
