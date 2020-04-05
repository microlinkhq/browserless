'use strict'

const express = require('express')
const app = express()
const port = 1337

const pretty = require('../../../src/pretty')

const data = {
  json: require('./data'),
  text: `build time AWS_REGION: us-east-1
. run time AWS_REGION: us-west-1
build time AWS_EXECUTION_ENV: AWS_ECS_FARGATE
. run time AWS_EXECUTION_ENV: AWS_Lambda_nodejs10.x`
}

app.get('/', async (req, res) => {
  const { contentType = 'json', codeScheme = 'atom-dark' } = req.query
  const response = { json: () => data.json, text: () => data.text }
  const page = { setContent: html => res.send(html) }
  res.setHeader('Content-Type', 'text/html; charset=UTF-8')
  await pretty(page, response, { codeScheme, contentType })
  res.end()
})

app.listen(port, () => console.log(`Example app listening at http://localhost:${port}`))
