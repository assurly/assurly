# Changelog

All notable changes to the published Assurly packages are documented here. The
format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
these packages follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Published packages: `@assurly/scanner-core`, `assurly`,
`@assurly/mcp-server`. They are released together and share a version.

## [1.0.2] — 2026-07-08

### Fixed

- **`@assurly/mcp-server`** — the server now reports its real package version in
  the MCP `initialize` handshake instead of a hardcoded `1.0.0`. The version is
  read from `package.json` at runtime, so it can no longer drift from the
  published npm version.
- **`@assurly/mcp-server`** — corrected the `assurly_explain_rule` tool title and
  description grammar ("Explain an Assurly Ship Gate rule").

### Changed

- **GitHub Action** — the Assurly action now runs on the Node.js 24 runtime
  (`using: node24`) instead of the deprecated Node.js 20, so consumers no longer
  see a runtime-deprecation warning in their workflow logs. CI workflows pin
  `actions/upload-artifact` to a Node 24 release as well.

## [1.0.1] — 2026-07-08

### Fixed

- **`@assurly/scanner-core`** — the `rsc-data-leaks` rule no longer flags
  TypeScript `import type` statements as client-side imports of server modules.
  Type-only imports are erased at compile time and never reach the browser
  bundle, so treating them as leaks produced false positives (surfaced by
  dogfooding `assurly scan` on the Assurly repo itself). Detection now skips
  `ImportDeclaration` nodes whose Babel `importKind` is `type`.

## [1.0.0] — 2026-07-08

First public release.

### Added

- **`@assurly/scanner-core`** — browser-safe static-analysis engine with
  confidence-aware rules for Next.js, Supabase, Stripe, and Vercel, plus the
  Ship Gate report (`blocked` / `review` / `ready` + a 0–100 Ship Score). Blocker
  discipline: only high-confidence, high-impact findings block; heuristics are
  review or warning.
- **`assurly`** — `npx assurly scan --path .` runs the gate locally
  (source never leaves the machine), prints concrete remediation, exits non-zero
  when blocked (CI-ready), and `init` scaffolds a GitHub Actions workflow.
- **`@assurly/mcp-server`** — a stdio MCP server exposing three tools —
  `assurly_scan_path`, `assurly_scan_files`, `assurly_explain_rule` — so
  Cursor, Claude Code, and other MCP clients can run the ship gate before deploy.

### Security

- All three packages are published to npm with
  [provenance](https://docs.npmjs.com/generating-provenance-statements) from
  GitHub Actions, so the published artifacts are cryptographically linked to the
  source commit and build.

[1.0.2]: https://github.com/assurly/assurly/releases/tag/v1.0.2
[1.0.1]: https://github.com/assurly/assurly/releases/tag/v1.0.1
[1.0.0]: https://github.com/assurly/assurly/releases/tag/v1.0.0
