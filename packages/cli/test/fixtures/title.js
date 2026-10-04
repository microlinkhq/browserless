'use strict'

module.exports = async ({ page, opts }) => {
  await page.setContent(`<title>${opts.title}</title>`)
  return { title: await page.title() }
}
