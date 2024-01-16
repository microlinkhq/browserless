const { format } = require('@lukeed/ms')
module.exports = require('@kikobeats/time-span')({ format: n => format(Math.round(n)) })
