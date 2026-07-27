# Changelog

All notable changes to the published Assurly packages are documented here. The
format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
these packages follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Published packages: `@assurly/scanner-core`, `assurly`,
`@assurly/mcp-server`. They are released together and share a version.

## [1.2.2] — 2026-07-27

### Added

- **`@assurly/mcp-server`** — `mcpName` in `package.json` and a `server.json`
  alongside it, so the server can be listed in the [official MCP
  registry](https://github.com/modelcontextprotocol/registry). The registry
  verifies that a listing's underlying package really belongs to the publisher by
  matching `server.json`'s `name` against `mcpName` in the published package,
  which is why this needs a release of its own rather than a metadata edit.

  The namespace is `dev.assurly/mcp-server`, claimed by proving control of
  `assurly.dev` over DNS. That route needs no public repository, so it is open to
  this project today. `server.json` deliberately omits `repository`, which is
  optional: the monorepo is private and a listing that links to a 404 is worse
  than one that links nowhere.

## [1.2.1] — 2026-07-27

### Fixed

- **`assurly`** — a focused scan no longer claims the whole project is ready.
  `scan --agent` and `scan --supply` printed "Your project is production-ready"
  and a `READY TO SHIP` verdict when their own narrow surface was clean, even
  though a full scan of the same project reported blockers. A focused run now
  names the surface it examined, prints no Ship Gate verdict, and points at
  `assurly scan` for a judgement about the project. A ship gate overstating its
  own scope is the failure this tool exists to prevent.

## [1.2.0] — 2026-07-27

### Added

- **`@assurly/scanner-core`, `assurly`** — install-time trust audit. npm 12
  stopped running dependency install scripts by default, so every project now
  records which dependencies it trusts to execute code at install time. Seven
  rules audit that decision from files the project already has — no network, no
  registry calls:
  - `supply-install-scripts-unreviewed` — the lockfile has packages that declare
    install scripts, but no allowlist records which ones are trusted.
  - `supply-allowscripts-unpinned` — an entry is a bare name or `name@*`, which
    grants script execution to every version of that package, including one
    published later by whoever takes it over. An exact pin does not.
  - `supply-allowscripts-stale` — an entry names a package no longer in the
    lockfile. If that name is re-added later it installs with execution already
    approved, which is why this cross-references `dep-slopsquat-suspect`.
  - `supply-allowscripts-invalid` — a range or dist-tag npm silently drops, so
    the entry grants nothing its author expects.
  - `supply-allowscripts-in-workspace` — an allowlist outside the workspace
    root, which npm ignores.
  - `supply-non-registry-dependency` — git, URL and tarball dependencies, which
    npm 12 also blocks by default.
  - `supply-npm-below-v12` — a `packageManager` or `engines.npm` pin that keeps
    the old defaults, so none of the above protections apply.
- **`assurly`** — `scan --supply` runs the install-time surface alone. The rules
  also run in every ordinary scan.

### Changed

- **`@assurly/mcp-server`** — no new tools, but `assurly_scan_path` and
  `assurly_scan_files` now return install-time trust findings, because the rules
  run as part of the standard scan.

### Notes

Every `supply-*` rule is warning-only and none can block a ship verdict. npm 12
shipped days before this release, so most projects will report findings here on
a first scan; a gate that fails every build in week one would be uninstalled in
week one.

## [1.1.0] — 2026-07-26

### Added

- **`@assurly/scanner-core`, `assurly`** — agent stack scanning: eight rules over
  the files that configure an AI coding agent rather than the application it
  builds. MCP client configs are checked for shell-command servers, `http://`
  endpoints, inline credentials, unpinned and unscoped packages; instruction
  files (`README`, `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, PR and issue
  templates) are checked for directives hidden in HTML comments or zero-width
  text, prior-instruction overrides, and exfiltration patterns.
- **`assurly`** — `scan --agent` runs the agent surface alone. The rules also run
  in every ordinary scan.
- **`@assurly/mcp-server`** — `assurly_scan_agent`, a fifth tool.

### Notes

Agent-stack findings are advisory and never block a ship verdict: they audit the
developer's tooling, not the application being deployed.

## [1.0.4] — 2026-07-20

### Fixed

- **`assurly`** — stack detection reads every `package.json` in the project, not
  only the one at the scanned root. In a workspace monorepo the root manifest is
  usually a bare workspace pointer, so a root-only read reported every framework,
  database and payment provider as absent — which silently disabled the Supabase
  and Stripe rules instead of flagging real issues.

## [1.0.3] — 2026-07-14

### Changed

- **`assurly`** — the terminal report is drawn in a frame with a meter that fills
  in proportion to the Ship Score, replacing the previous banners. It degrades
  honestly: box drawing falls back to ASCII on legacy Windows consoles, `TERM=dumb`
  and non-UTF-8 locales; colour honours `NO_COLOR`; piped output carries no escape
  bytes; and OSC 8 hyperlinks are emitted only for terminals on a known-good
  allowlist, never in CI and never when piped.

### Fixed

- **`assurly`** — `assurly --version` reported `1.0.0` on every release because the
  literal had drifted from the published version, so the CLI misidentified itself
  in bug reports. It now reads `package.json`.
- **All three packages** — internal dependency pins were left at `1.0.2`, so a
  version bump alone would have installed the previous release's code alongside
  the new one.

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
