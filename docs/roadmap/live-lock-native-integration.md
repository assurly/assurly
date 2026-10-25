# Live Lock as a native Vercel Marketplace integration

Status: planned (2026-10-25). Owner: Assurly. Supersedes the "user pastes a
bypass secret" idea for protected projects.

## Why

Live Lock runs today as a **connectable account** integration (`oac_…`, OAuth
redirect, Checks API v1). It is verified end to end on Hobby: the check holds a
production deploy with a proven runtime blocker and releases everything else.

One gap is structural. A project behind Deployment Protection answers the probe
with a Vercel login, so the check ends `deployment_protected` ("Not verified").
Minting a Protection Bypass for Automation from our token fails with:

> `400 bad_request Only native integrations can create automation bypass.`

Becoming a **native** integration closes that gap and brings the rest of the
Marketplace experience: install without an Assurly account, billing through
the customer's Vercel invoice, SSO into the dashboard, and a listing next to
Checkly under Testing / Monitoring.

## Facts this plan relies on (Vercel docs, read 2026-10-25)

| Fact                                                                                                                                                                                                                                                                                                       | Source                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| A native integration needs a provider **team on Pro**, a Base URL running the Partner API, and Marketplace program approval.                                                                                                                                                                               | `/docs/integrations/create-integration/marketplace-product` |
| One integration (`oac_…`) can carry both a connectable and a native installation per team; they are independent installations.                                                                                                                                                                             | `/docs/integrations/create-integration/native-integration`  |
| Required Partner API: `PUT`/`DELETE /v1/installations/{id}`, `POST`/`GET`/`DELETE /v1/installations/{id}/resources[/{rid}]`, `GET /v1/products/{slug}/plans`. Optional: `GET`/`PATCH` installation, `PATCH` resource, installation plans.                                                                  | `/docs/.../marketplace-api/reference/partner`               |
| Vercel authenticates every Partner API call with an OIDC JWT (`iss=https://marketplace.vercel.com`, `aud=<integration id>`, JWKS at `marketplace.vercel.com/.well-known/jwks`), user or system flavour.                                                                                                    | same                                                        |
| `PUT installation` carries a non-expiring `access_token` for Vercel API calls (checks, billing, notifications).                                                                                                                                                                                            | `/docs/.../marketplace-flows`                               |
| Native and connectable integrations can both use the Checks API; checks integrations are listed under Testing, Monitoring and Observability.                                                                                                                                                               | `/docs/checks`                                              |
| `integration-resource.project-connected` gives `projectId` and `productionDomain`.                                                                                                                                                                                                                         | `/docs/webhooks/webhooks-api`                               |
| Billing: installation- or resource-level plans, subscription or prepayment, interim billing data daily, invoices via `POST /v1/installations/{id}/billing/invoices`, Vercel handles tax, 15 days before destructive action on unpaid.                                                                      | `/docs/integrations/create-integration/billing`             |
| SSO: Vercel sends the user to our `redirectLoginUrl` with `code`; we exchange it at `POST /v1/integrations/sso/token`; `sso:` URLs in notifications.                                                                                                                                                       | `/docs/.../marketplace-api`                                 |
| Approval checklist (required): SSO both ways, account info from Get Account Information, plans, docs URL, 1920×1080 gallery, logo light/dark, **a Marketplace template (deploy button with `stores`)**, uninstall cleanup (`{finalized:true}`), reinstall = new installation, invoice test, support links. | `/docs/.../approval-checklist`                              |

**Not proven by the docs, proven by Phase 0:** that a native installation token
(a) receives `deployment.*` webhooks for connected projects, (b) can create v1
checks on them, (c) can create the automation bypass. The error text implies
(c). Nothing is built past Phase 1 until Phase 0 says go.

## Product shape

- **Product** `live-lock` ("Live Lock"), one per integration.
- **Resource** = one guarded Vercel project. The user creates a Live Lock
  resource, picks the mode in the metadata form (Monitor / Enforce), and
  connects it to a project in Vercel's own UI. No Assurly account, no URL
  verification step: Vercel attests the team owns the project, and the guarded
  URL is the project's `productionDomain`.
- **Secrets**: none are needed in the customer's build. The provision response
  returns one harmless `ASSURLY_LIVE_LOCK_ID` so the env var screen is not
  empty and the Getting Started snippet has something real to show.
- **Billing plans** (installation level):
  - _Free_: Monitor mode, one guarded project.
  - _Pro_: Enforce mode, unlimited projects, plus Assurly Pro entitlements in
    the dashboard. Same price as the Stripe Pro plan (`pricing.ts`), so there
    is one price for one product.

## Architecture

```
Vercel ──OIDC JWT──▶ /api/vercel/marketplace/v1/...   (Partner API)
                        │ installation ⇄ Assurly organization (auto-created)
                        │ resource      ⇄ live_lock_project + url target
Vercel ──HMAC──────▶ /api/vercel/integration/webhook  (existing, extended)
                        │ deployment.created/ready → Checks (unchanged engine)
                        │ project-connected/disconnected → link/unlink
                        │ marketplace.invoice.* → billing state
Vercel ──code──────▶ /api/vercel/marketplace/sso       (SSO → Supabase session)
Assurly ──token────▶ api.vercel.com                    (checks, bypass, billing)
```

The probe, conclusion rules, idempotent run claiming and the dashboard panel
stay as they are. The native path changes where the token and the lock come
from, not how a deploy is judged.

### Checks v2 for native locks

Vercel's own example integration (`vercel/example-marketplace-integration`)
shows how native checks work, and it is a better fit than the v1 per-deployment
check:

- On `integration-resource.project-connected`, create a **project check**:
  `POST /v2/projects/{projectId}/checks` with
  `source: { kind: 'integration', externalResourceId: <resource id> }`,
  `requires: 'deployment-url'`, `targets: ['production']`,
  `isRerequestable: true`, and `blocks: 'deployment-alias'` in Enforce or
  `'none'` in Monitor. It appears under the project's Deployment Checks.
- For every matching deployment Vercel sends `deployment.checkrun.start` with
  `checkRun.id`, `checkRun.source.integrationConfigurationId` and
  `checkRun.source.externalResourceId`. The run is concluded with
  `PATCH /v2/deployments/{deploymentId}/check-runs/{checkRunId}`
  (`status: completed`, `conclusion`, `externalUrl` may be `sso:`).
- Switching mode patches the project check's `blocks`; disconnecting deletes it.

So the native path needs no `deployment.created` registration and gets a
working Rerun button, which v1 could not give us. The v1 engine stays for the
connectable installs until they migrate.

### Data

- `private.vercel_installation` (native only): `installation_id` pk,
  `organization_id`, `token_ciphertext` (same AES as `vercel_connection`),
  `account_name`, `contact_email`, `billing_plan`, `status`
  (`active|deleted|finalized`), `deleted_at`. RPC wrappers granted to
  `service_role` only, like the existing Live Lock tables.
- `public.live_lock_project` gains `installation_id` and `resource_id`
  (nullable; set for native locks).
- `public.organizations` gains `billing_source` (`stripe|vercel|null`). Stripe
  webhooks never touch a Vercel-billed org and the other way round.
- `targets` gains ownership method `vercel_project` (attested by a signed
  `project-connected` event, re-checked against the project's domains through
  the installation token).

### Security rules

- Every Partner API call: verify JWT signature against the cached JWKS, `iss`,
  `aud === VERCEL_INTEGRATION_CLIENT_ID`, `exp`, and that `installation_id` in
  the token equals the one in the path. User-auth calls that change anything
  require `user_role === 'ADMIN'`.
- `Idempotency-Key` honoured on PUT/POST (Vercel retries).
- Tokens stored encrypted, never logged; the bypass secret still only goes to
  the deployment's own origin.
- SSO: `state` checked, `id_token` verified, email used only when
  `email_verified`/`user_email_verified` is true.

## Phases

Each phase ends green in CI and deployed. Commit per logical change.

### Phase 0: feasibility gate (blocking)

1. Provider team on Vercel Pro. Apply to the Marketplace program
   (`vercel.com/marketplace/program`) in parallel, since review takes time.
2. On the existing integration: set Base URL, create product `live-lock`
   with **private** visibility, Metadata Schema with `mode`.
3. Ship the Phase 1 minimum (JWT verify, upsert/delete installation, one free
   plan, provision/get/delete resource).
4. Install natively on our own team, create a resource, connect it to
   `assurly-live-target` (Deployment Protection on), redeploy.
5. Go if: `project-connected` arrives and `POST /v2/projects/{id}/checks`
   succeeds with the native token, `deployment.checkrun.start` arrives on
   redeploy, `PATCH /v1/projects/{id}/protection-bypass` succeeds, and the
   protected deployment is probed and its check run concluded.
   No-go: stop, keep the connectable integration, report what failed.

### Phase 1: Partner API foundation

JWT verifier (`jose`, JWKS cache with refetch on unknown `kid`), route
dispatcher under `/api/vercel/marketplace/v1/[...path]` through `secureRoute`,
installation upsert/get/patch/delete, installation ⇄ organization, account
info sync via Get Account Information. Tests: forged/expired/wrong-aud token,
installation mismatch, idempotent replays, reinstall gets a fresh org link.

### Phase 2: resources and project connection

Provision/get/patch/delete resource, metadata schema (mode), connect and
disconnect webhooks → target + lock, plan limits (Free = one project, Enforce
needs Pro), resource status and notifications. The native lock reuses
`registerDeploymentCheck` / `startDeploymentCheck` with `apiFor` resolving the
installation token; `probeThroughProtection` mints the bypass as designed.

### Phase 3: SSO and the dashboard

`redirectLoginUrl` → SSO token exchange → verified email → Supabase user
(admin link + server-side OTP verify sets the session cookie, so GitHub users
with the same email land in the same account) → membership in the installation
org (`ADMIN` → admin, `USER` → viewer) → deep link to the resource or the
`path` Vercel asked for (`billing`, `usage`, `support`, `onboarding`).
Provider-initiated SSO links in the dashboard and emails.

### Phase 4: billing

Plans endpoints, plan change via PATCH installation, `billing_source=vercel`
entitlements, daily interim billing data and monthly invoice (cron), invoice
webhooks (paid → active; notpaid/overdue → warn, downgrade to Free after 15
days, never delete data), refunds via invoice actions, delete-installation
finalization. Test-mode invoices before launch, then one real invoice and a
refund as the checklist asks.

### Phase 5: listing and approval

`/live-lock` docs rewritten for the native flow plus a Getting Started guide,
three or more 1920×1080 gallery images (light and dark legible), logo check,
the required Marketplace template (a small Next.js repo whose deploy button
provisions the Live Lock store), support URL and SSO support links, EULA and
privacy updates (Vercel bills and collects tax), the full approval checklist run
including logged-out install, existing-user install, reinstall and uninstall.
Then email integrations@vercel.com and hold the walkthrough call.

### Phase 6: migration

Existing connectable locks keep working. After approval, the dashboard offers
"Switch to the Vercel Marketplace install" (one click, carries the mode over),
and the connectable Redirect URL is removed once no live locks use it, as the
checklist expects when only the native flow is supported.

## Out of our hands

- Marketplace approval and its timeline (Vercel decides).
- Provider payout terms and revenue share: not public, asked in the
  application.
- The Pro plan on the provider team.
