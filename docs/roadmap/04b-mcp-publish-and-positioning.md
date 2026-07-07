# Phase 4b — MCP Publish & Positioning

> **Status:** proposed · **Branch:** `feat/phase-4b-mcp-publish` · **Priority:** 🟡 medium (closes Phase 4's value gap)

## Goal

Make the MCP server built in Phase 4 **reachable and installable by a real user**, not just runnable by someone who
clones the repo and builds it locally. Two halves, both required:

1. **Publish** `@assurly/scanner-core`, `assurly`, and `@assurly/mcp-server` to the public npm registry so
   `npx @assurly/mcp-server` works for a stranger.
2. **Position** the MCP server where a real visitor can find it — a public page reachable from the homepage, and an
   explicit place in the pricing story — instead of only in `packages/mcp-server/README.md`, which no one outside
   this repo will ever open.

## Why

Phase 4 shipped a working MCP server (`assurly_scan_path`, `assurly_scan_files`, `assurly_explain_rule`), fully
tested end-to-end with a real stdio client. But three things were verified true after shipping it, and none are
addressed anywhere else in the roadmap:

- **Nothing is published.** `npm view assurly|scanner-core|mcp-server` all return `404`. Today the only way
  to use the server is to clone the repo, build it, and point `.cursor/mcp.json` at an absolute local path — that is
  a workflow for a contributor, not a customer.
- **The landing site never mentions MCP.** A full search of `apps/web/src/app` for "mcp" / "model context protocol"
  returns nothing.
- **Phase 6 (Positioning, Pricing & Cleanup) does not cover it either.** Its messaging task reworks the homepage hook
  for one of the three north-star segments (vibe coders) but is silent on the second: _"AI agents (Cursor, Claude
  Code) — they need a ship-gate step before deploy, called over MCP."_ Without this phase, that segment has no
  distribution path at all — a real user cannot discover, install, or use the thing Phase 4 built.

A capability nobody can install and nobody can find does not exist for the business, even though the code is correct
and tested. This phase closes that gap without touching scanning logic or the MCP protocol surface — it is
distribution and messaging only.

## Scope / Non-goals

**In scope:**

- The npm publish plan and CI plumbing to make it repeatable (packing + a gated, human-triggered publish step).
- Upgrading `packages/mcp-server/README.md` to the post-publish (`npx`) experience, with a "build from source"
  fallback for contributors.
- One new public page presenting the MCP server to a visitor, plus exactly one link to it from the existing
  homepage nav/footer.
- An explicit, documented decision on where MCP sits in the pricing story (do not leave it implicit).
- Meta tags for the new page consistent with whatever Phase 6 lands for the rest of the site.

**Not in scope (do NOT do):**

- No new scanner rules, no new MCP tools, no protocol changes — that is Phase 4, already shipped.
- **No homepage redesign.** Same constraint as Phase 6: copy, structure, and metadata only. This phase adds one link,
  not a new marketing section on the homepage itself.
- No changes to CLI or scanner-core scanning behavior.
- **Do not run the actual `npm publish` command as part of implementing this phase.** Publishing a public package
  under a real npm org is a hard-to-reverse, externally visible action (a wrong publish cannot be un-published, only
  deprecated) — it is a human-authorized step, not something an agent executes autonomously. This phase builds the
  gated pipeline and documents the exact command; a human runs it.

## Verify before writing (Cursor: do this first)

- Confirm who owns (or will create) the `@assurly` npm org, and that npm 2FA is configured for the account that
  will run the publish — required for provenance-signed scoped packages.
- Confirm the `repository.url` already set in each package (`https://github.com/assurly/assurly.git`) is the
  real, current repository. `publishConfig.provenance: true` (already set in `packages/mcp-server/package.json`)
  requires the publish to run from a GitHub Actions workflow tied to that exact repository, or provenance
  verification fails at publish time.
- Read `.github/workflows/package-release.yml` in full. It already builds and packs `scanner-core` and `cli` as
  release-candidate tarballs, deliberately stops short of publishing, and says so in its trailing comment. Extend
  this workflow's philosophy — do not replace it or add an automatic publish-on-push step.
- Decide the first public version number for all three packages (they are currently aligned at `1.0.0` in the
  workspace) — this is a product decision, not a default to assume silently.

## Existing code to reuse

- `packages/mcp-server/package.json` — already has `bin`, `files`, and `publishConfig: { access: "public",
provenance: true }`. Reuse as-is; do not restructure it.
- `packages/mcp-server/README.md` — existing tool table and Cursor/Claude Code config blocks to upgrade in place
  (absolute local path → `npx @assurly/mcp-server`), not rewrite from scratch.
- `.github/workflows/package-release.yml` — extend the pack step to include `packages/mcp-server`; add the publish
  step as a separate, explicitly confirmed `workflow_dispatch` input, following the same "candidates vs. publish are
  different operations" split already documented in its trailing comment.
- `apps/web/src/app/privacy/page.tsx` — the existing pattern for a simple, static App Router informational page
  (`legal-container` styling, back-to-home link). Use this as the template for the new MCP page rather than
  inventing new layout primitives.
- `apps/web/src/app/_components/home/HomeHeader.tsx` — where the one new nav/footer link belongs.
- Root `README.md` — should gain a short, public-facing mention of the MCP server with a link, since it is the first
  thing a visitor from GitHub sees; today only the package-level README documents it.
- `docs/roadmap/06-positioning-pricing-cleanup.md` (Task B, pricing table) — read this before deciding MCP's pricing
  placement so the two phases don't contradict each other; if Phase 6 has already landed by the time this phase
  runs, update its pricing copy to include the decision made here instead of duplicating a second pricing table.

## Tasks

1. **Pre-publish audit** (no code changes) — confirm the items under "Verify before writing" above. Document the
   findings (org ownership, 2FA, provenance readiness, chosen first version) directly in this phase's PR description.
2. **CI: pack + gated publish.** Extend `package-release.yml` (or add a sibling workflow) to:
   - Add `packages/mcp-server` to the existing `npm pack` step, in dependency order (`scanner-core` → `cli` →
     `mcp-server`), since `mcp-server` depends on exact published versions of the other two.
   - Add a separate job/step, triggered only by manual `workflow_dispatch` with an explicit confirmation input (e.g.
     a required `confirm: "publish"` string), that runs `npm publish --provenance` for each package in that same
     order. Never trigger this on push, PR, or schedule.
3. **Docs upgrade.** Rewrite the "Cursor" and "Claude Code" sections of `packages/mcp-server/README.md` around
   `npx -y @assurly/mcp-server` as the primary path once published; keep the current build-from-source steps as a
   clearly labeled fallback for contributors working on this repo directly.
4. **Public page.** Add `apps/web/src/app/mcp/page.tsx` (or `apps/web/src/app/docs/mcp/page.tsx` if a `/docs` root
   is preferred) presenting: the one-sentence framing already in the root roadmap README ("a ship gate AI agents
   call before deploy"), the three-tool table, a copy-paste `.cursor/mcp.json` block, the `claude mcp add` command,
   and a link back to `/`. Follow the `privacy/page.tsx` static-page pattern.
5. **One homepage touchpoint.** Add exactly one link to this page from `HomeHeader.tsx` (nav or footer, whichever the
   existing header structure supports with the least disruption). No other homepage copy or layout change.
6. **Pricing placement — decide, don't default.** Document one explicit answer: either "MCP access is part of Free"
   (consistent with the free URL scan being the acquisition funnel for the same north-star segment) or "MCP access
   requires Guard/Agency." Whichever is chosen, state it on the new page and keep it consistent with Phase 6's
   pricing table.
7. **Metadata.** Give the new page a title, description, and OG/canonical tags consistent with whatever bar Phase 6
   Task D sets for the rest of the site, so it does not become a regression the moment that phase's tests run.

## New / changed files

```
.github/workflows/package-release.yml                 (change — add mcp-server to pack; add gated publish step)
packages/mcp-server/README.md                          (change — npx-based install as primary path)
apps/web/src/app/mcp/page.tsx                          (new — public MCP page)
apps/web/src/app/_components/home/HomeHeader.tsx       (change — one nav/footer link)
README.md (root)                                       (change — short MCP mention + link)
docs/roadmap/06-positioning-pricing-cleanup.md          (change, if already landed — reconcile pricing placement)
```

## Acceptance criteria

- [ ] The npm publish order and exact commands are documented; provenance and org/2FA prerequisites are confirmed in
      writing.
- [ ] `npm publish` is never executed automatically by CI or by an agent — only via manual `workflow_dispatch` with
      an explicit confirmation input, matching the existing `package-release.yml` philosophy.
- [ ] `packages/mcp-server/README.md` shows `npx @assurly/mcp-server` as the primary install path, with a clearly
      separated "build from source" section for contributors.
- [ ] A public page exists and is reachable from the homepage in **at most one click**, showing the tool table and
      working copy-paste configs for both Cursor and Claude Code.
- [ ] The homepage has exactly one new link added — no other homepage layout/copy changes (respects the same
      no-redesign boundary as Phase 6).
- [ ] MCP's place in pricing is explicitly decided and documented, not left ambiguous, and does not contradict
      Phase 6's pricing table.
- [ ] The new page meets the same OG/canonical/meta bar as the rest of the site.
- [ ] `npx tsc --noEmit` and `npm run lint` are clean; existing E2E and accessibility tests stay green.
- [ ] No scanner rule, CLI behavior, or MCP tool/protocol change — this phase is publish plumbing and positioning
      only.

## Tests

- **E2E:** the new page renders, the homepage nav link navigates to it, and its `<head>` carries the expected
  meta tags (`page.evaluate` against `document.head`, same technique as Phase 6's meta-tag tests).
- **A11y:** `npm run test:e2e -- accessibility.spec.ts` must stay green after the new page and nav link are added.
- **CI workflow:** no automated test can safely exercise a real `npm publish`; review the workflow YAML by hand
  (correct dependency order, the confirmation gate actually blocks accidental runs) rather than attempting to test it
  in CI.

## How to verify

```bash
# from apps/web
npx tsc --noEmit && npm run lint
npm run test:e2e -- accessibility.spec.ts

# manual
# 1. Visit /mcp locally and confirm the copy-paste config matches packages/mcp-server/README.md exactly.
# 2. Confirm the homepage has exactly one new link and is otherwise pixel-identical to before this phase.
# 3. Review (do not run) the package-release.yml publish job: correct order, confirmation input required,
#    never triggered on push/PR/schedule.
```
