# ADR 0005: Share scanner rules across all ShipReady surfaces

## Status

Accepted

## Decision

ShipReady uses `@shipready/scanner-core` as its browser-safe rule implementation. Web scans,
GitHub webhooks, and filesystem-backed CLI adapters consume the same functions. JavaScript and
TypeScript security decisions use Babel AST nodes rather than text or comment matching.

Remote scans use explicit configurable file budgets and emit a `scan-completeness` warning when
the budget truncates eligible files. The local CLI remains unlimited by default.

The VS Code extension bundles the pinned CLI into the VSIX and launches it with `execFile` and an
argument array. Release workflows only create auditable artifacts; publishing requires explicit
credentials and authorization.

## Consequences

- Rule behavior and identifiers remain consistent across products.
- Browser bundles pay the parser cost only where scanner code is imported.
- GitHub annotation display limits do not discard stored findings.
