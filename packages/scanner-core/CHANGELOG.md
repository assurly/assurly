# Changelog

All notable changes to `@assurly/scanner-core` are documented here.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.3

### Fixed

- Published without an npm provenance attestation. The attestation pointed at a
  private repository, so npm could not resolve the source commit and showed
  "Unable to find the source commit for this package" on every release. A claim
  nobody can verify is worse than none.
- Declared Node support no longer includes end-of-life Node 20.x releases;
  the requirement is now `^20.19.0 || >=22.12.0`, matching the project itself.

### Added

- A `bugs` entry, so npm links somewhere real for support instead of nowhere.
- This changelog.

## 1.0.2

- Maintenance release.

## 1.0.1

- Maintenance release.

## 1.0.0

- First public release.
