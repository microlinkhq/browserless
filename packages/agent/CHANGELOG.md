# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [14.0.14](https://github.com/microlinkhq/browserless/compare/v14.0.13...v14.0.14) (2026-10-08)

### Bug Fixes

* **agent:** wait for a delayed same-tab navigation before observing ([#979](https://github.com/microlinkhq/browserless/issues/979)) ([7f10496](https://github.com/microlinkhq/browserless/commit/7f1049602cf982314a588eaedd04c7822e2ca110))

## [14.0.13](https://github.com/microlinkhq/browserless/compare/v14.0.12...v14.0.13) (2026-10-08)

### Bug Fixes

* **agent:** observe a control again only after it stops being busy ([#978](https://github.com/microlinkhq/browserless/issues/978)) ([22b2f49](https://github.com/microlinkhq/browserless/commit/22b2f4947fe61e70e30713a6c6eb23d572fd5550))

## [14.0.12](https://github.com/microlinkhq/browserless/compare/v14.0.11...v14.0.12) (2026-10-08)

### Bug Fixes

* **agent:** find listbox options that render outside aria-controls ([#977](https://github.com/microlinkhq/browserless/issues/977)) ([5cd1023](https://github.com/microlinkhq/browserless/commit/5cd10238b4e67861bff91f2c5aedccc75cb6d34a))

## [14.0.11](https://github.com/microlinkhq/browserless/compare/v14.0.10...v14.0.11) (2026-10-08)

### Bug Fixes

* **agent:** index in-flow icon controls that have no accessible name ([#976](https://github.com/microlinkhq/browserless/issues/976)) ([dcf45ee](https://github.com/microlinkhq/browserless/commit/dcf45ee319c4dc8c0831a214c03043cc41351a47))

## [14.0.10](https://github.com/microlinkhq/browserless/compare/v14.0.9...v14.0.10) (2026-10-08)

### Bug Fixes

* **agent:** hit-test each line of a wrapping link ([#974](https://github.com/microlinkhq/browserless/issues/974)) ([196566f](https://github.com/microlinkhq/browserless/commit/196566f3e3f2dc8a22947cb0d552bc7a1620904c))
* **agent:** offer a transparent checkbox through its visible label ([#975](https://github.com/microlinkhq/browserless/issues/975)) ([1637c72](https://github.com/microlinkhq/browserless/commit/1637c72f723aac9f2486340b79c11823288d594a))

## [14.0.9](https://github.com/microlinkhq/browserless/compare/v14.0.8...v14.0.9) (2026-10-08)

### Bug Fixes

* **agent:** let the text helper clear a field with an empty string ([#973](https://github.com/microlinkhq/browserless/issues/973)) ([1c6dcfe](https://github.com/microlinkhq/browserless/commit/1c6dcfec443b908440070af82d6fa07901ab2aee))
* **agent:** report an indeterminate checkbox as mixed ([#972](https://github.com/microlinkhq/browserless/issues/972)) ([0765c3d](https://github.com/microlinkhq/browserless/commit/0765c3d4a79152e859d8c86bdffaf80da205b1e8))

## [14.0.8](https://github.com/microlinkhq/browserless/compare/v14.0.7...v14.0.8) (2026-10-08)

### Bug Fixes

* **agent:** report aria-pressed so a toggle is not clicked blind ([#971](https://github.com/microlinkhq/browserless/issues/971)) ([e2978bd](https://github.com/microlinkhq/browserless/commit/e2978bdce61d30b6414b6c133d1ca1d24ef821f3))

## [14.0.7](https://github.com/microlinkhq/browserless/compare/v14.0.6...v14.0.7) (2026-10-08)

### Bug Fixes

* **agent:** keep an element's own text when aria-labelledby lists itself ([#970](https://github.com/microlinkhq/browserless/issues/970)) ([adbfd4a](https://github.com/microlinkhq/browserless/commit/adbfd4a07a9c859345a594c4cd35e9fb54171c06))

## [14.0.6](https://github.com/microlinkhq/browserless/compare/v14.0.5...v14.0.6) (2026-10-08)

### Bug Fixes

* **agent:** do not name an unlabeled select from its options ([#969](https://github.com/microlinkhq/browserless/issues/969)) ([ab210ef](https://github.com/microlinkhq/browserless/commit/ab210efd2a38a0b2288559728a877cf348cfdd09))

## [14.0.5](https://github.com/microlinkhq/browserless/compare/v14.0.4...v14.0.5) (2026-10-08)

### Bug Fixes

* **agent:** keep a literal arrow in an ordinary control label ([#967](https://github.com/microlinkhq/browserless/issues/967)) ([164be05](https://github.com/microlinkhq/browserless/commit/164be0519410f1622e224a0070b34c9d9de84793))
* **agent:** name a button from its text, not its value ([#968](https://github.com/microlinkhq/browserless/issues/968)) ([96c16a7](https://github.com/microlinkhq/browserless/commit/96c16a7f789a8e5d43b284b613612a31c90581be))

## [14.0.4](https://github.com/microlinkhq/browserless/compare/v14.0.3...v14.0.4) (2026-10-08)

### Bug Fixes

* **agent:** index pointer rows the element table could not see ([#966](https://github.com/microlinkhq/browserless/issues/966)) ([25a9564](https://github.com/microlinkhq/browserless/commit/25a9564a4877f661604c364ae430696635a7e549))
* **agent:** tell the text helper which same-labeled field it is filling ([#965](https://github.com/microlinkhq/browserless/issues/965)) ([8b92ba1](https://github.com/microlinkhq/browserless/commit/8b92ba16d03e3f736f2dcb701f88169c6202e10a))

## [14.0.3](https://github.com/microlinkhq/browserless/compare/v14.0.2...v14.0.3) (2026-10-08)

### Bug Fixes

* **agent:** read form text through the native innerText getter ([#964](https://github.com/microlinkhq/browserless/issues/964)) ([bb5f1fc](https://github.com/microlinkhq/browserless/commit/bb5f1fc698edf27c8c82489ca27ec53f8bf9aa42))

## [14.0.2](https://github.com/microlinkhq/browserless/compare/v14.0.1...v14.0.2) (2026-10-08)

### Performance Improvements

* **agent:** skip off-screen subtrees when reading page text ([#963](https://github.com/microlinkhq/browserless/issues/963)) ([ec2ce8c](https://github.com/microlinkhq/browserless/commit/ec2ce8c915205892fd69dca38569c3de460efa69))

## [14.0.1](https://github.com/microlinkhq/browserless/compare/v14.0.0...v14.0.1) (2026-10-08)

### Bug Fixes

* **agent:** hide the node map and stop when a field value is missing ([#962](https://github.com/microlinkhq/browserless/issues/962)) ([8b18674](https://github.com/microlinkhq/browserless/commit/8b186743962e540f58579614c86d22e1421e7518))

## [14.0.0](https://github.com/microlinkhq/browserless/compare/v13.16.4...v14.0.0) (2026-10-08)

### ⚠ BREAKING CHANGES

* **agent:** page.extract(instruction, schema) is removed.
* **agent:** results are plain objects. `status: 'done'` is now
  `'success'`, `await result()` is `await result.profiling()`, extract's data is
  in `data`, and BlockedError is no longer thrown but returned as `error`.
* **agent:** the default export no longer runs a goal.
* **agent:** the value extract resolves to is a function carrying the
  data, so `typeof` is 'function' and deep equality needs `.toJSON()`.

### Features

* **agent:** page.goal and page.extract, plus browserless exec ([#958](https://github.com/microlinkhq/browserless/issues/958)) ([b6ca363](https://github.com/microlinkhq/browserless/commit/b6ca3636f7e7f3da3d536f55bfe9beec70311b06)), references [#960](https://github.com/microlinkhq/browserless/issues/960)
