# Deploy Checklist

This is the **one authoritative sequence** for shipping `main` (Phases 0–5) to production. Read it top to bottom
before touching anything — the order matters, and two of the steps below are irreversible or externally visible.
Do not skip ahead.

> **Nothing described here has been run yet.** As of this checklist's creation, `main` is only ahead of
> `origin/main` locally — no push, no migration, no deploy, no npm publish has happened.

---

## 0. Pre-flight (run once, before any step below)

```bash
git status                 # working tree must be clean
git log origin/main..main --oneline   # review every commit you are about to ship
nvm use                    # Node 22 — required by .nvmrc
```

From `apps/web`:

```bash
npx tsc --noEmit && npm run lint
npm run test
npm run test:e2e -- accessibility.spec.ts
```

From the repo root:

```bash
npm run scan:self          # must exit 0 (dogfood gate)
```

If any of these fail, stop — do not proceed to a step that touches a shared or production system.

---

## 1. Push to origin

```bash
git push origin main
```

**Why first:** everything after this point (migrations, deploy, publish) should run against the code that is
actually in the shared history, not just on your machine. If CI is configured on push, let it run and go green
before continuing.

---

## 2. Apply database migrations (BEFORE deploying the web app)

Fourteen migrations exist under `apps/web/supabase/migrations/`. The most recent, added in Phase 5, is
**not optional**:

```
20260705120000_scan_finding_confidence.sql
```

This adds a nullable `confidence` column to `scan_findings`. **The order here is not negotiable:** if the web app
is deployed before this migration runs, every `saveScan` call (the GitHub webhook AND the client-side dashboard
save) will fail trying to insert a column that does not exist yet.

```bash
cd apps/web
supabase link --project-ref <your-project-ref>   # once, if not already linked
supabase db push                                  # applies all pending migrations, in order
```

Verify before moving on:

```bash
supabase migration list                           # confirm 20260705120000_... shows as applied remotely
```

**Rollback note:** the new column is nullable with no backfill — NULL reads as `'high'` confidence (the historical
default), so applying it is safe even if you decide not to proceed to step 3 immediately. There is nothing to undo
if you stop here.

---

## 3. Configure environment variables (before or during deploy)

Confirm every variable in `apps/web/.env.example` is set in the hosting provider's project settings — **never commit
real values**. Phase 5 added two that are easy to miss because the app degrades silently without them (the code
no-ops instead of erroring):

| Variable            | Required for                       | Failure mode if missing                                                                                                       |
| ------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`    | Regression alert emails            | Silently skipped — `notify.ts` logs a warning and no email is sent. No user-facing error, so this is easy to miss in testing. |
| `RESEND_FROM_EMAIL` | The `from` address on alert emails | Same silent no-op path.                                                                                                       |

Everything else in `.env.example` (Supabase, Stripe, GitHub App, rate-limit secret) should already be configured from
earlier phases — this step is a **diff check**, not a full re-entry, unless this is a first deploy.

```bash
grep -oE '^[A-Z_]+=' apps/web/.env.example | sort
```

Open your host's environment variable list for the production project side by side with this output and confirm
every key is present. Do this by hand — hosting providers expose this differently (dashboard UI, `vercel env ls`,
etc.) and a scripted diff is not worth the false confidence of a mismatched format.

---

## 4. Deploy the web app

Deploy `apps/web` through your normal hosting flow (Vercel dashboard / `vercel --prod` / your CI's deploy job — this
repo does not commit a `vercel.json`, so deployment is provider-managed).

After deploy, smoke-test the surfaces Phase 5 added, since they are new and have no prior production traffic to
lean on:

```bash
curl -sI https://<your-domain>/api/badge/00000000000000000000000000000000
# a well-formed (32 hex chars) but non-existent token
# expect: HTTP 404, empty body (unknown token must not leak whether a repo/scan exists)

curl -s https://<your-domain>/mcp | grep -o '<h1>[^<]*</h1>'
# expect: <h1>Assurly MCP Server</h1>
```

Then manually trigger one GitHub PR webhook against a connected test repo and confirm:

- the check run completes,
- a scan row is persisted,
- if you intentionally introduce a new high-confidence blocker, exactly one regression email arrives (only if
  `RESEND_API_KEY` is set — otherwise confirm the warning appears in logs instead).

---

## 5. Publish the MCP packages to npm (separate, human-only operation)

This is **not part of the web deploy** and has its own gate, built in Phase 4b:
`.github/workflows/package-release.yml` will only publish when manually dispatched with an explicit confirmation —
it never runs on push, PR, or schedule.

**Prerequisites (one-time, do these before the first dispatch):**

- [ ] Create the `assurly` **GitHub org** and transfer this repository into it, so the origin becomes
      `github.com/assurly/assurly` (path A, chosen). All three `package.json` files already declare
      `repository.url = https://github.com/assurly/assurly.git` — after the transfer they match reality, which
      `publishConfig.provenance: true` **requires** (provenance verifies the publish ran from Actions on this exact
      repo). Update the local `git remote set-url origin` and the GitHub App / webhook URLs after the move.
- [ ] Create the `@assurly` **npm org** (or confirm you own it) and enable 2FA on the publishing account.
- [ ] Add `NPM_TOKEN` (an Automation token with publish access) to the repository's GitHub Actions secrets.
- [ ] Confirm the first public version number. All three packages are `1.0.0`.
- [ ] After publishing, work through `docs/mcp-directory-submissions.md` — listing the MCP server in the MCP
      directories is what makes it discoverable to Cursor / Claude Code users (free, high-leverage distribution).

**Publish (in this exact order — `mcp-server` depends on the other two):**

1. Go to the repository's Actions tab → **Package release candidates** → **Run workflow**.
2. Set the `confirm` input to exactly `publish`.
3. The workflow publishes `scanner-core` → `cli` → `mcp-server`, each with `--provenance`.

**Verify:**

```bash
npm view @assurly/scanner-core version
npm view assurly version
npm view @assurly/mcp-server version

npx -y @assurly/mcp-server &
sleep 2 && kill %1 2>/dev/null
# the server is stdio-only (no CLI flags) and blocks waiting for an MCP client,
# so this just confirms npx can resolve and start it without a module error —
# for a real functional check, add it to .cursor/mcp.json or use
# `npx @modelcontextprotocol/inspector node <path>` as done during Phase 4 QA.
```

Once published, update `packages/mcp-server/README.md` and the `/mcp` page copy if the install command changed from
what is already documented there (it should not have — both already show the post-publish `npx` form).

---

## Summary — order of operations

```
1. git push origin main
2. supabase db push                    (BEFORE step 4 — confidence column must exist first)
3. confirm env vars (RESEND_API_KEY, RESEND_FROM_EMAIL + existing ones)
4. deploy apps/web
5. npm publish via workflow_dispatch    (separate, human-confirmed, any time after step 1)
```

Steps 1–4 are one release. Step 5 (MCP publish) is independent and can happen before, after, or in parallel — it
only depends on the code being in `main`, not on the web app being deployed.
