'use strict'

const path = require('path')

const spec = path.resolve(__dirname, '../../browserless/test/spec.js')

require(spec)(require('../src'))
