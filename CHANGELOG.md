# Changelog

All notable changes to the published Assurly packages are documented here. The
format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
these packages follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Published packages: `@assurly/scanner-core`, `assurly`,
`@assurly/mcp-server`. They are released together and share a version.

## [1.0.0] — Unreleased

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

[1.0.0]: https://github.com/assurly/assurly/releases/tag/v1.0.0
