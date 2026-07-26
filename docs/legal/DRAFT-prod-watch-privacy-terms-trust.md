# DRAFT FOR LEGAL REVIEW — Production log watch (D5c)

> **STATUS: PROPOSAL ONLY — NOT BINDING COPY.**
>
> Do **not** paste these paragraphs into live Privacy / Terms / Trust pages until
> counsel has signed off. Existing commitments on those pages must not be removed
> or narrowed without explicit legal approval.
>
> **Sign-off required before enabling Prod Watch in production**
> (`ASSURLY_PROD_WATCH_ENABLED=1`). Until then the feature stays behind a
> default-off feature flag even if the code has shipped.
>
> Placeholders such as `[LEGAL ENTITY NAME]` on live pages remain unresolved as
> of 2026-07-26 and are a separate gate from this draft.

---

## A. Privacy Policy — proposed additions

### A.1 New processing purpose (propose under §5 table)

| Purpose | Data | Legal basis |
| --- | --- | --- |
| Optional production abuse-signal monitoring (“Prod Watch”), when the customer explicitly enables it for a target | Derived query-shape counts and verdicts only (see A.2); encrypted customer-supplied read-only Supabase Management API credential; target and organisation identifiers | Performance of a contract — Art. 6(1)(b), limited to the opt-in feature the customer enabled |

**Controller / processor roles (propose as new §3.x or §4.x subsection):**

> **[LEGAL REVIEW]** When you enable Prod Watch, you remain the **controller** of
> any personal data that may appear in your Supabase project logs. Assurly acts as
> your **processor** solely to fetch those logs on your instruction, derive
> non-identifying abuse signals, and discard the raw lines in the same request.
> We do not use log content for model training, advertising, or any purpose other
> than the Prod Watch feature you enabled.

### A.2 Data categories actually touched

**Fetched ephemerally (never persisted):**

- Supabase edge / API log lines returned by the Management API for the customer’s
  project during a bounded lookback window (may include end-user IP addresses,
  user agents, and request metadata in the upstream payload).

**Persisted (derived only):**

- Counts of classified **query shapes** per time bucket
  (`schema_introspection`, `table_enumeration`, `bulk_read`, `other`).
- A coarse verdict (`clear` / `abuse_sequence` / `not_checked`).
- Open-incident metadata used to collapse repeat alerts (timestamps, rule id).
- Encrypted copy of the customer-supplied Management API access token and the
  Supabase project ref the customer entered.

**Never persisted:**

- Raw log lines.
- IP addresses (in any form).
- User agents, auth headers, request bodies, or response bodies.

### A.3 Retention (propose under retention section)

> Derived Prod Watch signals and incident rows are retained for **7 days**, then
> deleted. Enabling credentials are deleted immediately when the customer disables
> Prod Watch for a target, together with a purge of that target’s derived rows.
> Rationale: the signal is only useful for recent abuse sequences; longer
> retention would recreate a personal-data archive we deliberately avoid.

### A.4 Privacy Policy §7 sub-processor table — proposed row

| Recipient | Role | Location | Data |
| --- | --- | --- | --- |
| **Supabase (customer’s project, via Management API)** | Customer-directed source system (not Assurly’s sub-processor of Assurly-hosted data; listed for transparency) | Per customer’s Supabase region | Assurly calls the customer’s project **read-only** to retrieve log analytics the customer authorised. Assurly does not become a sub-processor *of Supabase*; Assurly is processor of the customer for the derived signal only. |

> **[LEGAL REVIEW]** Confirm whether this belongs in §7 as a sub-processor or as a
> separate “customer-directed integrations” subsection. Do not invent a DPA with
> Supabase on Assurly’s behalf for the customer’s project.

---

## B. Terms of Service — proposed additions

### B.1 Service description

> **[LEGAL REVIEW]** Prod Watch is an optional, explicitly enabled observation
> feature. When enabled for a target you own, Assurly may periodically call the
> Supabase Management API with a credential you supply to read recent API logs for
> that project, derive abuse-sequence signals, and surface review-level alerts.
> Prod Watch is not part of the pre-deploy Ship Gate verdict and never blocks a
> ship or merge.

### B.2 Customer authorisation

> **[LEGAL REVIEW]** By enabling Prod Watch and providing a Management API
> credential, you represent that you are authorised to grant Assurly read access
> to that Supabase project’s logs, and that you instruct Assurly to process those
> logs as your processor for the sole purpose of deriving abuse signals. You must
> supply a **read-only** credential. You may disable Prod Watch at any time; on
> disable we delete the stored credential and purge derived signal data for that
> target.

### B.3 Disclaimer — no monitoring SLA / no duty to detect

> **[LEGAL REVIEW — CRITICAL]** Prod Watch is provided **without** any commitment
> of continuous coverage, guaranteed detection, alerting latency, or completeness.
> Ordinary application traffic, log gaps, API errors, disabled opt-in, or feature
> flags may result in no check being performed. Assurly has **no duty to detect**
> abuse, intrusion, or data exfiltration. Alerts, if any, are informational
> observations about traffic that has already occurred and do not create a
> monitoring or security-operations obligation.

---

## C. Trust page — proposed section (data handling for Prod Watch)

> **[LEGAL REVIEW]** Proposed as a new factual subsection under Trust data-handling
> (near §5), matching the existing “precise, not aspirational” register:

**What is read (ephemerally):** recent Supabase API/edge log metadata for a
project you explicitly enrolled, via the Management API host Assurly hardcodes,
using a credential you supplied.

**What is stored:** derived query-shape counts per time bucket, a coarse verdict,
alert-collapse metadata, and the encrypted credential + project ref. Retention:
7 days for derived rows; credentials removed on disable.

**What is never stored:** raw log lines; IP addresses; user agents; request or
response bodies.

**What we do not promise:** continuous monitoring, guaranteed detection, or any
response-time SLA. Prod Watch findings never block a ship.

---

## D. Sign-off checklist (human)

- [ ] Privacy purpose / roles / categories / retention approved
- [ ] Privacy §7 (or alternate subsection) approved
- [ ] Terms service description + authorisation + no-duty disclaimer approved
- [ ] Trust page Prod Watch subsection approved
- [ ] Live-page `[LEGAL ENTITY NAME]` / VAT / address placeholders resolved
  (independent gate)
- [ ] Explicit approval to set `ASSURLY_PROD_WATCH_ENABLED=1` in production
