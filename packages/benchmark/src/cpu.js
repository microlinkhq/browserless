'use strict'

const sieveOfErathosthenes = require('sieve-of-eratosthenes')
const bench = require('nanobench')

const N = process.argv[2] || 1000

const ITERATIONS = [...Array(N).keys()]

bench('calculate a sieve value', async function (b) {
  b.start()
  ITERATIONS.forEach(() => sieveOfErathosthenes(33554432))
  b.end()
})
