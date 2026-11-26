'use strict'

const HAGEZI_MULTI_PRO_URL =
  'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.txt'

const DOMAIN_RULE = /^\|\|[^$]+\^$/

const toThirdPartyRules = list =>
  list
    .split('\n')
    .map(line => line.trim())
    .filter(line => DOMAIN_RULE.test(line))
    .map(rule => `${rule}$third-party`)

module.exports = { HAGEZI_MULTI_PRO_URL, toThirdPartyRules }
