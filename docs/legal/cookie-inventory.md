# ShipReady — Cookie Inventory (EU transparency)

- **Policy version:** 2026-06-27
- **Scope:** `shipready.dev` web app (marketing site, dashboard, legal pages)
- **Source of truth in code:** `apps/web/src/utils/cookieInventory.ts`

## Summary

ShipReady uses **strictly necessary cookies only**. We do **not** set advertising, analytics, retargeting, or social-media tracking cookies. Because optional cookies are absent, we show an **informational cookie notice** (not a consent management platform with Accept/Reject categories).

If product analytics or marketing pixels are added in the future, this inventory must be updated and a full CMP with prior consent must be implemented before those scripts load.

## HTTP cookies

| Name                            | Category           | Purpose                                                                                                                           | Duration                       | Party       |
| ------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------- |
| `shipready-session`             | Strictly necessary | Authenticated dashboard session; Supabase access/refresh tokens; optional GitHub OAuth token for connected scans and auto-fix PRs | Until session expiry or logout | First-party |
| `sb-*-auth-token-code-verifier` | Strictly necessary | PKCE verifier during GitHub OAuth sign-in                                                                                         | Minutes (transient)            | First-party |
| `sb-*-auth-token` (legacy)      | Strictly necessary | Cleared on login/logout if left from older builds                                                                                 | Expired immediately            | First-party |

### Technical notes

- **`shipready-session`:** HttpOnly; Path=/; SameSite=Lax; Secure in production. Set by `/api/auth/callback` after GitHub sign-in.
- **PKCE verifier:** Only the Supabase `code-verifier` cookie is persisted during OAuth. Supabase `auth-token` cookies are deliberately **not** stored by current builds (single session store).
- **GitHub OAuth redirect:** When you sign in, GitHub may set its own cookies on `github.com`. ShipReady does not control those cookies.

## Non-cookie essential storage

| Name                                               | Category           | Purpose                                                | Duration                                          |
| -------------------------------------------------- | ------------------ | ------------------------------------------------------ | ------------------------------------------------- |
| `shipready-cookie-notice-dismissed` (localStorage) | Strictly necessary | Remembers dismissal of the informational cookie notice | Until site data cleared or policy version changes |

## Third parties without ShipReady tracking cookies

| Service      | When                                        | Cookies on ShipReady domain?                                             |
| ------------ | ------------------------------------------- | ------------------------------------------------------------------------ |
| **Stripe**   | Billing checkout / customer portal redirect | No — Stripe cookies apply on `stripe.com`                                |
| **Vercel**   | Hosting                                     | No marketing/analytics cookies in app code; server access logs only      |
| **Supabase** | Auth backend                                | Session stored in `shipready-session`, not third-party marketing cookies |
| **Resend**   | Contact form email                          | No cookies set in browser                                                |

## Legal basis (EEA/UK summary)

| Processing                  | Basis                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Session + OAuth cookies     | **Performance of a contract** (Art. 6(1)(b) GDPR) — required to deliver the signed-in service you requested |
| Security / abuse prevention | **Legitimate interests** (Art. 6(1)(f)) — proportionate and documented in Privacy Policy                    |
| Contact form                | **Consent** (Art. 6(1)(a))                                                                                  |

Under the ePrivacy Directive, strictly necessary cookies do not require opt-in consent. Optional cookies would require prior consent before being set.

## Change log

| Date       | Change                                                                     |
| ---------- | -------------------------------------------------------------------------- |
| 2026-06-27 | Initial inventory; informational cookie notice; expanded Privacy Policy §6 |
