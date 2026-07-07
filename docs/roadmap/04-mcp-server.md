# Phase 4 — MCP Server (Ship Gate for AI Agents)

> **Status:** proposed · **Branch:** `feat/phase-4-mcp-server` · **Priority:** 🟡 medium (strategic)

## Goal

Build an **MCP (Model Context Protocol) server** over `@assurly/scanner-core` so AI agents (Cursor, Claude Code,
Copilot) can call Assurly as a **pre-deploy step** — "verify this app is ready to ship." New package
`packages/mcp-server`.

## Why

Verified 2026 trend: security automation increasingly flows through MCP, not proprietary SDKs. This is the one
position where the AI code-review giants do not cannibalize us — they **call** us: the agent that writes the app
invokes us to check it. And we get there before the niche clones, which have no MCP. Low effort: the CLI scan logic
already exists; we wrap it into MCP tools.

## Scope / Non-goals

**In scope:**

- New package `packages/mcp-server` (stdio MCP server, TypeScript, `@modelcontextprotocol/sdk`).
- Tools that wrap existing scan logic and return a Ship Gate result to the agent.
- A README with `mcp.json` configuration for both Cursor and Claude Code.

**Not in scope (do NOT do):**

- No new detection logic — only wrap `scanner-core`.
- No networked/hosted MCP (local stdio only for now).
- Do not change web or CLI behavior.

## Verify before writing (Cursor: do this first)

- Check the current `@modelcontextprotocol/sdk` (TypeScript) API — the `McpServer` / tool-registration signatures
  evolve. **Read the current package docs; do not rely on older patterns.**
- Read `packages/cli/src/index.ts` and `packages/cli/src/detector.ts` — how the CLI detects the stack, reads files,
  and builds the report. Call the same logic from the MCP tools (extract a shared function so CLI and MCP share code,
  rather than shelling out to the CLI as a subprocess).

## Existing code to reuse

- **Scan core:** `@assurly/scanner-core` (all `scan*` functions + `buildShipGateReport`), and the Phase 0
  `fileRelevance` filter so the MCP scan matches CLI/web behavior.
- **CLI orchestration:** `packages/cli/src/` — `detector`, `rules/`, `shipGateReporter`. Extract
  "scan directory → ShipGateReport" into a shared function used by both CLI and MCP.
- **Report formats:** `formatShipGatePlainText` and the markdown export in `shipGate.ts` — MCP can return both.

## Proposed MCP tools

| Tool                   | Input                                  | Output                                                               |
| ---------------------- | -------------------------------------- | -------------------------------------------------------------------- |
| `assurly_scan_path`    | `{ path: string }` (local project dir) | Ship Gate report (JSON + human summary), verdict, ship score         |
| `assurly_scan_files`   | `{ files: {path, content}[] }`         | Same, from provided files (the agent already has content in context) |
| `assurly_explain_rule` | `{ ruleId: string }`                   | Explanation of the rule + how to fix it (so the agent can remediate) |

> Typical agent flow: write code → call `assurly_scan_path` → get blockers → fix → re-scan until `READY TO SHIP`.
> That loop is the "ship gate" we sell.

## Tasks

1. **Bootstrap the package** `packages/mcp-server` (package.json, tsconfig, esbuild build like the other packages).
2. **Shared scan function:** extract "scan directory → ShipGateReport" from the CLI into a function usable outside
   the CLI, so MCP calls the logic directly (not via subprocess).
3. **Implement the MCP server** with stdio transport and the three tools above.
4. **Config + docs:** a README with an `mcp.json` example for Cursor (`.cursor/mcp.json`) and a `claude mcp add ...`
   command for Claude Code. Include the exact launch command.
5. **Tests:** unit-test the shared scan function; "tool handler" tests (call the handler with fixture files →
   assert the Ship Gate output) without needing a live stdio transport.

## New / changed files

```
packages/mcp-server/package.json                (new)
packages/mcp-server/tsconfig.json               (new)
packages/mcp-server/src/index.ts                (new — MCP server + transport)
packages/mcp-server/src/tools.ts                (new — tool handlers)
packages/mcp-server/src/tools.test.ts           (new)
packages/mcp-server/README.md                   (new — mcp.json config for Cursor + Claude Code)
packages/cli/src/... or packages/scanner-core/src/...   (change — extracted shared scan function)
```

## Acceptance criteria

- [ ] `packages/mcp-server` builds (`npm run build` in the package) with no errors.
- [ ] The MCP server starts over stdio and lists the three tools.
- [ ] `assurly_scan_files` with a fixture (e.g. SQL without RLS) returns verdict `NOT READY TO SHIP` + a blocker.
- [ ] `assurly_scan_files` with clean fixtures returns `READY TO SHIP`.
- [ ] `assurly_explain_rule('supabase-rls')` returns a meaningful explanation + fix.
- [ ] The CLI still behaves identically (the extracted shared function broke nothing — CLI tests green).
- [ ] The README contains a working `.cursor/mcp.json` example and a Claude Code command.

## Tests

- **Unit:** the shared scan function against `test-projects/broken-project` and `test-projects/clean-project`
  (existing fixtures) → expected verdicts.
- **Tool handlers:** call handlers directly with fixture inputs → assert structure and verdict (no real stdio transport).

## How to verify

```bash
# from repo root
npm run build -w @assurly/mcp-server
npm run test -w @assurly/mcp-server
# manual: add to .cursor/mcp.json and confirm Cursor sees the tools
```
