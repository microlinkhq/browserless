'use strict'

const sieveOfErathosthenes = require('sieve-of-eratosthenes')
const bench = require('nanobench')

const N = Number(process.argv[2]) || 10

const ITERATIONS = [...Array(N).keys()]

bench('calculate a sieve value', b => {
  b.start()
  ITERATIONS.forEach(() => sieveOfErathosthenes(33554432))
  b.end()
})
