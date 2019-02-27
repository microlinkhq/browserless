/**
 * @file Page Number browserless extension
 *
 * @description Implements a PDF page number generation content with a token replacement method
 *
 * @author José da Mata <https://github.com/josemf>
 */

'use strict'

const fs = require('fs')
const tmp = require('tmp')

const pdf_extract = require('pdf-extract')

/**
 * This function parse the document for <span|a|etc class="pageNumber"> and create substitution tokens in two different forms:
 *
 * 1. PDF:PAGE_NUMBER_<N>
 * 2. PDF:PAGE_NUMBER_REF(<ID>) if `rel` attribute is supplied
 *
 * If the second form is used within the document, every element with <ID> will be queried and a location token is
 * created in the form of PDF:ID(<ID>).
 */
function evalTokenize () {
  let idReferences = []
  let indexReferences = 0

  document.querySelectorAll('.pageNumber').forEach(el => {
    if (el.hasAttribute('rel')) {
      let idReference = el.getAttribute('rel')

      el.innerHTML = 'PDF:PAGE_NUMBER_REF(' + idReference + ')'
      el.className = '__pdf_page_number_' + idReference
      idReferences.push(idReference)
    } else {
      el.innerHTML = 'PDF:PAGE_NUMBER_' + indexReferences
      el.id = '__pdf_page_number_' + indexReferences

      ++indexReferences
    }
  })

  idReferences.forEach(id => {
    let el = document.getElementById(id)
    let t = document.createElement('div')

    t.innerHTML = 'PDF:ID(' + id + ')'
    t.style.position = 'absolute'
    t.style.fontSize = '1px'
    t.className = '__pdf_reference_placeholder_token'

    el.appendChild(t)
  })

  return {
    idReferences,
    indexReferences
  }
}

/**
 * This function will replace every page number token for the corresponding page number
 *
 * @param {object} indexReferencePage - A object map with index to page number
 * @param {object} idReferencePage - A object map with ID to page number
 */
function evalReplaceTokensWithPageNumbers ({ indexReferencePage, idReferencePage }) {
  // Replace indexed page numbers

  Object.keys(indexReferencePage).forEach(index => {
    let el = document.getElementById('__pdf_page_number_' + index)

    if (el) {
      el.innerHTML = indexReferencePage[index]
    }
  })

  // replace id reference page numbers

  Object.keys(idReferencePage).forEach(id => {
    document.querySelectorAll('.__pdf_page_number_' + id).forEach(el => {
      el.innerHTML = idReferencePage[id]
    })
  })

  // remove reference placeholder

  document.querySelectorAll('.__pdf_reference_placeholder_token').forEach(el => {
    el.remove()
  })
}

/**
 * Given a <Buffer> object for some PDF file, this function will extract all the text within
 *
 * @param {Buffer} pdfBuffer - PDF contents
 *
 * @return {Array} - Per page indexed PDF contents
 */
function extractTextFromPdf (pdfBuffer) {
  return new Promise(async (resolve, reject) => {
    let pdfFilePath = await saveBufferToTmpFile(pdfBuffer)

    var processor = pdf_extract(pdfFilePath, { type: 'text' }, function (err) {
      if (err) {
        reject(err)
      }
    })

    processor.on('complete', function (data) {
      resolve(data.text_pages)
    })
    processor.on('error', function (err) {
      reject(err)
    })
  })
}

/**
 * This function parse PDF page contents and make data structures suitable for token replacements in a PDF
 *
 * @param {object} pageTextContents - Per page indexed PDF contents
 *
 * @return {object} - idReferencePage and indexReferencePage objects, id and index token references mapped to actual page numbers
 */
function parseTokensPageNumbers (pageTextContents) {
  let idReferencePage = {},
    indexReferencePage = {}

  // Resolve tokens for page numbers

  for (let i = 0; i < pageTextContents.length; ++i) {
    let pageNumber = i + 1,
      pageContents = pageTextContents[i],
      indexRegex = /PDF\:PAGE_NUMBER_(\d)+/g,
      idRegex = /PDF\:ID\(([^\)]+)\)/g,
      indexMatch = indexRegex.exec(pageContents),
      idMatch = idRegex.exec(pageContents)

    while (indexMatch !== null) {
      indexReferencePage[indexMatch[1]] = pageNumber

      indexMatch = indexRegex.exec(pageContents)
    }

    while (idMatch !== null) {
      idReferencePage[idMatch[1]] = pageNumber

      idMatch = idRegex.exec(pageContents)
    }
  }

  return { idReferencePage, indexReferencePage }
}

function saveBufferToTmpFile (buffer) {
  var tmpFileName = tmp.tmpNameSync()

  return new Promise((resolve, reject) => {
    fs.open(tmpFileName, 'w', function (err, fd) {
      if (err) {
        return reject(err)
      }

      fs.write(fd, buffer, 0, buffer.length, null, function (err) {
        if (err) {
          return reject(err)
        }
        fs.close(fd, function () {
          return resolve(tmpFileName)
        })
      })
    })
  })
}

module.exports = async (page, options = {}) => {
  // Does token replacement for pageNumber elements

  await page.evaluate(evalTokenize)

  // Generate and parse PDF for tokens/page number matching

  let tokensPageNumbers = await parseTokensPageNumbers(
    await extractTextFromPdf(await page.pdf(options))
  )

  // Replace tokens and cleanup

  await page.evaluate(evalReplaceTokensWithPageNumbers, tokensPageNumbers)
}
