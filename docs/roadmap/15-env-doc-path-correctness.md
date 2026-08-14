# 15 — Env Doc Path Correctness

> **Status:** shipped · **Branch:** `fix/env-doc-path-correctness` · **Priority:** trust

## Goal

`undocumented-env` warnings must name the correct package-local `.env.example` in a monorepo, and GitHub Actions / runner injected variables must never require project documentation.

## Scope

- `proposeEnvExamplePath` + no-ancestor fallback in `scanEnvVariables` when `allExamples` is provided.
- Explicit Actions/runner keys in `FRAMEWORK_ENV_KEYS`.
- Manual Checker Fix-all writes env docs to the finding’s target path (not the first `.env.example` in the tree).

## Non-goals

- Committing new package `.env.example` files just to silence self-scan.
- Blanket `GITHUB_*` suppression.
- Snippet-tab env UX changes.

## Acceptance Criteria

1. Code under `packages/cli` with only `apps/web/.env.example` present suggests `packages/cli/.env.example`.
2. Prefixed workspace paths (`shipready/packages/...`) preserve the prefix in the suggestion.
3. `GITHUB_OUTPUT` / `GITHUB_STEP_SUMMARY` produce zero findings.
4. Fix-all creates/updates the package-local example and leaves sibling package examples untouched.

## Existing code to reuse

- `resolveEnvExampleForPath`, `scanEnvVariables`, `FRAMEWORK_ENV_KEYS` in `@assurly/scanner-core`
- Manual Checker `applyEnvVarsToExampleFiles` / `applyAllFixableFindingsToProject`
