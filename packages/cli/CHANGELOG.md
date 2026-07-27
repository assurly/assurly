# Changelog

All notable changes to `assurly` are documented here.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.2.1

### Fixed

- A focused scan no longer speaks for the whole project. `--agent` and
  `--supply` printed "Your project is production-ready" and a `READY TO SHIP`
  verdict whenever their own surface was clean — the same project could report
  ready under `--supply` and blocked under a full scan. Focused runs now name the
  surface, print no verdict, and point at `assurly scan`.

## 1.2.0

### Added

- Install-time trust rules (`supply-*`), auditing the npm 12 install-script
  allowlist, lockfile packages that declare install scripts, non-registry
  dependencies and npm version pins. Offline: everything is read from
  `package.json`, `package-lock.json` and the project's own `.npmrc`. Values from
  `.npmrc` are never echoed, since that file holds auth tokens.
- `scan --supply` runs the install-time surface alone. The rules also run in
  every ordinary scan.

### Notes

Every `supply-*` finding is warning-only and cannot block a ship verdict. npm 12
shipped days before this release, so most projects will report findings on a
first scan.

## 1.1.0

### Added

- Agent stack rules (`agent-*`) covering MCP client configuration and agent
  instruction files, with an explanation for each rule id.
- `scan --agent` runs the agent surface alone. The rules also run in every
  ordinary scan.

### Notes

Agent-stack findings are advisory: they audit the developer's tooling, not the
application being deployed, and never block a ship verdict.

## 1.0.4

### Fixed

- Stack detection now reads every `package.json` in the project, not just the one
  at the scanned root. In a workspace monorepo (npm/pnpm/yarn workspaces,
  Turborepo, Nx) the root manifest is usually a bare workspace pointer with no
  dependencies of its own, and the real framework/database/payments packages live
  in nested manifests such as `apps/web/package.json`. The root-only read reported
  `Framework: unknown / Database: none / Payments: none` on such repos, which
  silently disabled every Stripe and Supabase rule — both gate on the detected
  stack — so a monorepo scanned "clean" for exactly the two categories the tool
  exists to check. Detection now merges dependencies across all workspace members
  (still skipping `node_modules`, `.git`, `dist`, and other build folders) and a
  malformed manifest in one member no longer blanks out detection for the rest.

## 1.0.3

### Added

- Redrawn terminal output: a framed Ship Gate panel, and a meter under the verdict that
  fills in proportion to the Ship Score.
- Graceful degradation for every terminal. Box drawing falls back to ASCII where it cannot
  render (legacy Windows consoles, `TERM=dumb`, non-UTF-8 locales), colour honours
  `NO_COLOR`, and piped output carries no escape sequences at all. Terminal hyperlinks are
  emitted only for terminals known to support OSC 8 — never in CI, never when piped —
  because a terminal that does not understand them prints the control bytes inline.
- A `bugs` entry, so npm links somewhere real for support instead of nowhere.
- This changelog.

### Fixed

- `assurly --version` reported `1.0.0` on every release. The version was hardcoded and had
  drifted from the published package, so it misidentified itself in bug reports. It is now
  read from `package.json`.
- Published without an npm provenance attestation. The attestation pointed at a private
  repository, so npm could not resolve the source commit and showed "Unable to find the
  source commit for this package" on every release. A claim nobody can verify is worse
  than none.
- Declared Node support no longer includes end-of-life Node 20.x releases; the requirement
  is now `^20.19.0 || >=22.12.0`, matching the project itself.

### Changed

- Rewrote the README around the questions people actually ask before deploying, with the
  full rule coverage and an honest comparison against ESLint, `npm audit` and Semgrep.

## 1.0.2

- Maintenance release.

## 1.0.1

- Maintenance release.

## 1.0.0

- First public release.
