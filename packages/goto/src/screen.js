'use strict'

const DESKTOP_SCREENS = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 }
]

const PORTRAIT_DESKTOP_SCREENS = DESKTOP_SCREENS.map(({ width, height }) => ({
  width: height,
  height: width
}))

const getScreen = ({ width, height }) =>
  (height > width ? PORTRAIT_DESKTOP_SCREENS : DESKTOP_SCREENS).find(
    screen => screen.width >= width && screen.height >= height
  ) ?? { width, height }

module.exports = { getScreen }
