# Assurly Live Lock: Vercel Marketplace listing kit

Everything to paste into the Integration Console for the native product, and
the approval checklist with where each item stands. Prepared 2026-10-26 (Phase
5 of `docs/roadmap/live-lock-native-integration.md`).

Integration slug: `assurly-live-lock` · Product slug: `live-lock`

## Integration Console fields

| Field                            | Value                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Name                             | Assurly Live Lock                                                                                    |
| Short description (≤ 100 chars)  | Check every production deploy before it reaches your domain.                                         |
| Category                         | Testing (secondary: Monitoring, Security if offered)                                                 |
| Website                          | https://assurly.dev                                                                                  |
| Documentation URL                | https://assurly.dev/live-lock/getting-started                                                        |
| Support URL                      | https://assurly.dev/?subject=technical#contact                                                       |
| Privacy policy                   | https://assurly.dev/privacy                                                                          |
| EULA / Terms                     | https://assurly.dev/terms                                                                            |
| Base URL (Partner API)           | https://assurly.dev/api/vercel/marketplace                                                           |
| Redirect Login URL (SSO)         | https://assurly.dev/api/vercel/marketplace/sso                                                       |
| Webhook URL                      | https://assurly.dev/api/vercel/integration/webhook                                                   |
| Installation-level Billing Plans | **On**                                                                                               |
| Logo                             | `apps/web/public/icon-512.png` (512×512)                                                             |
| Gallery (1920×1080)              | `apps/web/public/marketplace/live-lock-gallery-1.png` … `-5.png` (first one is the Open Graph image) |
| Redirect URL (connectable flow)  | Keep until existing dashboard locks are migrated (Phase 6), then remove                              |

Webhook events to subscribe (as the Integration Console names them):
`deployment.created`, `deployment.ready` (under Check Events),
`deployment.checkrun.start`, `integration-resource.project-connected`,
`integration-resource.project-disconnected`.

Subscribed automatically, not selectable: `marketplace.invoice.created`,
`.paid`, `.notpaid`, `.overdue`, `.refunded` and
`integration-configuration.removed`. The console does not offer
`deployment.check-rerequested`; a Rerun of a native check arrives as a new
`deployment.checkrun.start`.

Permissions: Deployments (read), Deployment Checks (read/write), Projects
(read), Project Protection Bypass (read/write), Integration Configuration
(read).

### Overview (markdown)

```markdown
Assurly Live Lock checks every production deployment **before it reaches your
domain**. When a build is ready, Assurly makes a fresh, read-only check of that
exact deployment and reports in Vercel's Deployment Checks.

- **Monitor** (Free): every production deploy is checked and nothing is held.
  You see which deploys _would_ have been held back.
- **Enforce** (Pro): a proven, high-severity blocker, such as a database table
  anyone can read or a secret in the browser bundle, keeps production on the
  previous deployment. Force Promote ships it anyway.
- **Only proof holds a deploy.** Timeouts, unreachable deployments and outages
  on our side end neutral and Vercel releases the deploy.
- Works with Deployment Protection, signs you in with your Vercel account, and
  bills through your Vercel invoice.

[Get started](https://assurly.dev/live-lock/getting-started)
```

### Instructions (shown after install)

```markdown
1. Create a Live Lock and choose Monitor or Enforce.
2. Connect it to the project you want to guard.
3. Deploy to production. The **Assurly Live Lock** check appears on the
   deployment; use **Open in Assurly** for details.

Vercel adds `ASSURLY_LIVE_LOCK_ID` to the connected project. It is not a
secret and your code does not need it.
```

### Product: `live-lock`

| Field                     | Value                                                                        |
| ------------------------- | ---------------------------------------------------------------------------- |
| Name                      | Live Lock                                                                    |
| URL slug                  | live-lock                                                                    |
| Visibility                | Private until approval, then Public                                          |
| Short description         | A deployment check that holds back production deploys with a proven blocker. |
| Disable Resource Renaming | Off                                                                          |

Metadata Schema:

```json
{
  "$schema": "https://vercel.com/api/v1/integrations/marketplace/metadata-schema",
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "ui:control": "radio-button",
      "ui:label": "Mode",
      "ui:description": "Monitor reports and never holds a deploy. Enforce holds a deploy with a proven blocker (Pro plan).",
      "enum": ["monitor", "enforce"],
      "ui:options": [
        {
          "value": "monitor",
          "label": "Monitor",
          "description": "Check every production deploy; never hold one."
        },
        {
          "value": "enforce",
          "label": "Enforce",
          "description": "Hold a deploy with a proven blocker. Needs the Pro plan."
        }
      ],
      "default": "monitor"
    }
  },
  "additionalProperties": false,
  "required": ["mode"]
}
```

Plans come from the Partner API (`GET /v1/products/live-lock/plans`): Free and
Pro ($17/month, installation scope, billed in arrears).

### Marketplace template (required)

`templates/live-lock-nextjs` is a minimal Next.js app whose README carries the
deploy button with the `stores` parameter:

```
https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fassurly%2Flive-lock-nextjs&project-name=live-lock-nextjs&repository-name=live-lock-nextjs&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22assurly-live-lock%22%2C%22productSlug%22%3A%22live-lock%22%7D%5D
```

It builds clean with Next.js 16.4.3. It must be published as the public
repository `assurly/live-lock-nextjs` before the button works (owner action).

## Approval checklist (native integrations)

Status: ✅ done and tested · 🧪 built, verified in Phase 0 · 👤 owner action ·
⏳ open.

### Authentication and setup

| Item                                           | Status | Where                                                                                                       |
| ---------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| OAuth / SSO authenticate securely; Vercel SSO  | 🧪     | `api/vercel/marketplace/sso`, `utils/vercelSso.ts`                                                          |
| Provider-initiated SSO                         | ⏳     | links to `vercel.com/sso/integrations/assurly-live-lock/{installationId}` not added to emails/dashboard yet |
| Upsert Installation creates and syncs accounts | 🧪     | `utils/vercelMarketplace.ts` (one workspace per team)                                                       |
| Account info from Get Account Information      | ⏳     | contact email comes from Upsert Installation; refresh via Get Account Information not built                 |

### Product listing

| Item                                            | Status  | Where                                                                                           |
| ----------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| Name, description, logo (light and dark)        | 👤      | fields above; logo is the existing 512 px app icon                                              |
| Plans correct                                   | ✅      | `MARKETPLACE_PLANS`, unit tests                                                                 |
| Documentation URL                               | ✅      | `/live-lock/getting-started`                                                                    |
| Category                                        | 👤      | Testing                                                                                         |
| Gallery 1920×1080, readable in both themes      | ✅      | 5 images, opaque dark background, regenerate with `node scripts/marketplace-gallery/render.mjs` |
| Connectable flow works, or Redirect URL removed | ✅      | connectable flow live and verified; Redirect URL stays until Phase 6                            |
| Marketplace template                            | ✅ / 👤 | `templates/live-lock-nextjs`; publish the repo                                                  |

### Installation and configuration

| Item                                              | Status                      |
| ------------------------------------------------- | --------------------------- |
| New user without an Assurly account               | 🧪                          |
| Existing Assurly user (same email)                | 🧪                          |
| Logged-out external install flow                  | 🧪                          |
| Metadata schema renders (Preview Form)            | 🧪                          |
| Env vars set with correct targets                 | 🧪 (`ASSURLY_LIVE_LOCK_ID`) |
| Uninstall cleans up, `{finalized:true}`           | ✅ unit tests, 🧪 live      |
| End to end: install → resource → connect → deploy | 🧪                          |

### Feature functionality

| Item                                         | Status                                                    |
| -------------------------------------------- | --------------------------------------------------------- |
| Core feature (checks hold/release correctly) | ✅ on the connectable flow (Hobby, 2026-10-25), 🧪 native |
| Usage shown in Vercel                        | 🧪 (Submit Billing Data with "Guarded projects")          |
| Invoice submission and lifecycle             | 🧪 test-mode invoice, then one real invoice               |
| Getting Started guide published              | ✅                                                        |
| Snippets / quick-start on product page       | 👤 paste Instructions above                               |

### Billing and usage

| Item                                                         | Status                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| Billing correct, prorated                                    | ✅ unit tests                                            |
| Interim billing data at least daily (ideally hourly)         | ✅ daily now; switch the cron to hourly after Vercel Pro |
| Refunds via Invoice Actions                                  | ⏳ manual support action                                 |
| notpaid / overdue handled, 15 days before destructive action | ✅ nothing is ever deleted for non-payment               |

### Documentation and support

| Item                                                     | Status                                  |
| -------------------------------------------------------- | --------------------------------------- |
| Docs complete at the Documentation URL                   | ✅                                      |
| Support link from listing                                | ✅ contact form                         |
| Support link from installed product (SSO `support=true`) | ✅ opens the contact form after sign-in |

### Edge cases

| Item                                | Status                                              |
| ----------------------------------- | --------------------------------------------------- |
| Concurrent installs, scale          | ✅ idempotent upserts, invoice claims, run claiming |
| Invalid config, expired tokens      | ✅ 400/401 with Vercel-format errors                |
| Reinstall gets a fresh installation | ✅ new installation id → new workspace              |

## Owner actions before emailing integrations@vercel.com

1. Vercel Pro on the provider team; create product `live-lock` with the fields
   above (Phase 0).
2. Publish `templates/live-lock-nextjs` as `assurly/live-lock-nextjs`.
3. Run Phase 0 end to end, including a test-mode invoice, one real invoice and a
   refund.
4. Flip `MARKETPLACE_LISTED` in `apps/web/src/app/live-lock/getting-started/page.tsx`
   and add the page to the sitemap when the listing goes public.
