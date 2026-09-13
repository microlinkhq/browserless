'use strict'

const NOTIFICATIONS = { name: 'notifications' }

const SETTING_PROMPT = 'prompt'
const SETTING_DENIED = 'denied'

const setNotifications = async (page, notifications) =>
  page
    ._client()
    .connection()
    .send('Browser.setPermission', {
      browserContextId: page.browserContext().id,
      permission: NOTIFICATIONS,
      setting: notifications ? SETTING_PROMPT : SETTING_DENIED
    })

module.exports = { setNotifications }
