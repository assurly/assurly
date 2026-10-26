# Vercel Marketplace program application: Assurly Live Lock

Form: https://vercel.com/marketplace/program#become-a-provider
Fields: Company name, Contact name, Email address, Company website, then **Next**
(a later step may ask for more; the text below covers the usual questions).

Prepared 2026-10-26. Fill the `<…>` values yourself; nothing else needs editing.

## Form fields

| Field           | Value                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| Company name    | `<legal name of the company or sole proprietorship that owns Assurly>` |
| Contact name    | `<your full name>`                                                     |
| Email address   | `<the address Vercel should reach you on, ideally a domain address>`   |
| Company website | `https://assurly.dev`                                                  |

## Message (paste if the form offers a free-text step, or send to integrations@vercel.com)

**Subject: Marketplace provider application: Assurly Live Lock (Checks integration)**

Hello Vercel Marketplace team,

I would like to apply to become a Marketplace provider with **Assurly Live Lock**,
a native deployment-check integration.

**What it does**
Assurly checks a production deployment for blockers a code review cannot see:
exposed admin routes, open databases, leaked secrets and unprotected APIs, as the
live app actually serves them. Live Lock runs that check on every production
deployment through the Vercel Checks API. In _Monitor_ mode it only reports. In
_Enforce_ mode it fails the check, so Vercel holds the production domains on the
previous deployment until the problem is fixed. Anything Assurly cannot verify
(a timeout, Deployment Protection, an unreachable deployment) concludes
**neutral**, so Assurly never holds a deploy without proof.

**Who it is for**
Developers shipping fast with AI builders and frameworks (Next.js on Vercel in
particular) who do not have a security review step before production.

**Where it fits**
Category: Testing, Monitoring and Observability (Checks integration). It follows
the guidance on the Checks page: no configuration to start, guided onboarding
from install to first result, the outcome shown in the Vercel dashboard, and a
documented path for advanced use.

**Product shape**

- One product, _Live Lock_. A resource is one guarded Vercel project.
- A team creates the resource in Vercel, connects it to a project, and picks
  Monitor or Enforce. No Assurly account is needed to install.
- Each production deployment gets a Checks v2 check run with a one-line result
  and a link to the details.
- Plans (installation-level): **Free** (Monitor, one project) and **Pro**
  (Enforce, unlimited projects), $17 per month billed through Vercel.

**Where we are**

- Partner API implemented and deployed: installation upsert/get/update/delete,
  resource provision/get/update/delete, billing plans. Every request is verified
  against Vercel's OIDC keys, with audience, issuer and installation checks.
- Checks v2 project check and check runs implemented, including Rerun.
- The same engine already runs as a connectable-account integration and has been
  verified end to end: it held a production domain on the previous deployment
  when a blocker was proven, and released every deployment that was clean or
  unverifiable.
- In progress: SSO into the Assurly dashboard, invoice and usage submission,
  gallery assets, documentation and the Marketplace template.
- Marketplace base URL: `https://assurly.dev/api/vercel/marketplace`

**What I would like to ask**

1. Is Live Lock a fit for the Marketplace as a native Checks integration?
2. Is there anything beyond the published approval checklist I should plan for
   (legal terms, payout details, minimum requirements for a Free plan)?
3. Who should I speak to about the final walkthrough once the checklist is done?

Assurly is also published as an npm CLI and MCP server (`assurly`,
`@assurly/mcp-server`). I am happy to share a demo project, a recorded
walkthrough, or a call at your convenience.

Thank you,
`<your full name>`
`<company>` · https://assurly.dev · `<email>`

## Before you send

- Do not claim customers or usage numbers unless you can show them.
- The provider team needs the Vercel Pro plan before the product can be created;
  mention it only if asked.
- Billing, SSO and the Marketplace template are not finished yet. The text says
  so on purpose: Vercel reviews by walkthrough, and a plain status is better
  received than a claim it can check.
