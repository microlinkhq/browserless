/* global chrome */
/* eslint-disable no-useless-return */

chrome.commands.onCommand.addListener(async command => {
  if (command !== 'invoke-action') return
})
