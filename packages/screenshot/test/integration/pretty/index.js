'use strict'

const { extension } = require('mime-types')
const pReflect = require('p-reflect')
const express = require('express')
const got = require('got')

const app = express()
const port = 1337

const pretty = require('../../../src/pretty')

const getContentType = headers => {
  const ext = extension(headers['content-type'])
  return ext === 'txt' ? 'text' : ext
}

const getContent = async url => {
  const { isRejected, value, reason } = await pReflect(got(url, { responseType: 'buffer' }))
  const result = isRejected ? reason.response : value
  const contentType = getContentType(result.headers)
  const data = result.body
  return { data, contentType }
}

app.get('/', async (req, res) => {
  const { codeScheme = 'atom-dark', url } = req.query
  const { contentType, data } = await getContent(url)
  const response = { json: () => JSON.parse(data.toString()), text: () => data.toString() }
  const page = { setContent: html => res.send(html) }
  // res.setHeader('Content-Type', text/html; charset=UTF-8')
  await pretty(page, response, { codeScheme, contentType })
  res.end()
})

app.listen(port, () => console.log(`Example app listening at http://localhost:${port}`))
