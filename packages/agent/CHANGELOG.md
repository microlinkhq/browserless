# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

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
