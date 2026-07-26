# Cyber Resilience Act — scope assessment

**Document status:** internal assessment (not a compliance certification).  
**Regulation:** Regulation (EU) 2024/2847 (Cyber Resilience Act).  
**Assessment date:** 2026-07-26.  
**Owner:** Assurly maintainers.

This document records which Assurly components we treat as **products with digital
elements** under the Regulation for planning purposes. It does **not** assert that
Assurly is CRA-compliant, certified, or that every obligation has been met.

---

## 1. Working definition (summary)

A product with digital elements is a software or hardware product and its remote
data processing solutions whose intended purpose or reasonably foreseeable use
includes a direct or indirect connection to a device or network. Manufacturers of
such products face essential cybersecurity requirements and, from
**11 September 2026**, reporting duties for actively exploited vulnerabilities
(24-hour early warning; 72-hour notification) via the CRA Single Reporting Platform.

Assurly is software distributed to third parties and operated as a hosted service.
We therefore assess both **published packages** and the **hosted application**.

---

## 2. In scope (treat as products with digital elements)

| Component                                  | Distribution                         | Rationale                                                    |
| ------------------------------------------ | ------------------------------------ | ------------------------------------------------------------ |
| `assurly` (CLI)                            | npm public package                   | Standalone software product installed by customers           |
| `@assurly/scanner-core`                    | npm public package                   | Library embedded in CLI, MCP, Action, and web analysis paths |
| `@assurly/mcp-server`                      | npm public package                   | Agent-facing software product                                |
| Assurly web application & API (`apps/web`) | Hosted SaaS at the production origin | Remote data processing solution that customers connect to    |
| Assurly GitHub App / Action distribution   | GitHub Marketplace / repo Action     | Software customers install into their CI                     |

These components process or influence security-relevant decisions (ship verdicts,
probes, alerts). They are the surface an actively exploited vulnerability would
most likely affect customers.

---

## 3. Out of scope / not treated as Assurly products

| Component                                                                         | Why                                                                                 |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Customer applications scanned or probed by Assurly                                | Third-party products; Assurly is not their manufacturer                             |
| Subprocessor infrastructure (Vercel, Supabase, Stripe, Anthropic, Resend, GitHub) | Third-party products; report to those manufacturers when their systems are at fault |
| Internal dogfood / throwaway test projects                                        | Not placed on the market                                                            |
| Pure documentation under `docs/`                                                  | Not a product with digital elements by itself                                       |

---

## 4. Reporting readiness (what exists vs what this is not)

**Exists (as of this assessment):**

- Coordinated vulnerability disclosure policy on the Trust page (§13).
- Machine-readable contact via `/.well-known/security.txt` (RFC 9116).
- Internal runbook: [`docs/runbooks/cra-actively-exploited-vulnerability-reporting.md`](./runbooks/cra-actively-exploited-vulnerability-reporting.md).
- Machine-generated SBOMs for published npm packages (`npm run sbom:published`).

**This assessment does not claim:**

- CRA conformity assessment completion.
- Appointment of an authorised representative or notified body engagement.
- That Assurly meets every essential cybersecurity requirement in Annex I.
- Continuous monitoring SLA or guaranteed detection of exploitation.

User-facing copy must stay in the same register as the Trust page certifications
section: precise about what we have (a runbook, a disclosure path), silent about
certifications we do not hold.

---

## 5. Review cadence

Re-read this assessment when:

- a new package is published under the Assurly / `@assurly` namespace;
- the hosted product adds a new customer-facing processing purpose; or
- the Regulation’s implementing acts change reporting mechanics.

Next scheduled review: **2026-09-01** (ahead of the 11 September 2026 reporting
start date).
