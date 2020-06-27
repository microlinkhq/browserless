'use strict'

module.exports = {
  'washingtonpost.com': () => {
    const freeButton = document.querySelector('.gdpr-consent-container .continue-btn.button.free')
    if (freeButton) freeButton.click()
    const gdprcheckbox = document.querySelector(
      '.gdpr-consent-container .consent-page:not(.hide) #agree'
    )
    if (gdprcheckbox) {
      gdprcheckbox.checked = true
      gdprcheckbox.dispatchEvent(new window.Event('change'))
      document
        .querySelector(
          '.gdpr-consent-container .consent-page:not(.hide) .continue-btn.button.accept-consent'
        )
        .click()
    }
  }
}
