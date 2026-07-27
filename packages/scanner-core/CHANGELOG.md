# Changelog

All notable changes to `@assurly/scanner-core` are documented here.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.2.0

### Added

- Install-time trust detection (`scanSupplyChain`). npm 12 stopped running
  dependency install scripts by default, so projects now record which
  dependencies they trust to execute code at install time. Seven rules audit
  that allowlist, the lockfile's `hasInstallScript` packages, non-registry
  dependencies, and npm version pins — entirely from local files, with no
  network access.
- The distinction that carries the most weight: an allowlist entry that is a
  bare name or `name@*` grants script execution to every version of that
  package, including one published later by a new owner. An exact pin does not.

## 1.1.0

### Added

- Agent stack detection (`scanAgentStack`) — eight rules over MCP client
  configuration and agent instruction files: shell-command servers, `http://`
  endpoints, inline credentials, unpinned and unscoped packages, directives
  hidden in HTML comments or zero-width text, prior-instruction overrides, and
  exfiltration patterns.
- `HIGH_CONFIDENCE_BLOCKER_RULE_IDS` moved into its own module with the
  reasoning for each entry recorded alongside it.

### Changed

- The ship gate routes `agent-*` and `supply-*` findings to review and never to
  blockers. Keeping ids off the blocker allowlist was not sufficient on its own,
  because classification is by severity and confidence rather than by id.

## 1.0.4

- No code changes. Version kept in lockstep with `assurly` and
  `@assurly/mcp-server`, which pin exact internal dependency versions, so all
  three are released together. The 1.0.4 fix lives in `assurly` (workspace-aware
  stack detection).

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
