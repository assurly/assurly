/**
 * Curated, plain-language business consequences per rule id — the product's voice.
 *
 * This module is intentionally PURE (no server-only imports) so it is safe to use
 * from client components. The AI fallback and org-budget logic live in
 * `consequenceTranslator.ts`, which is server-only.
 */

export interface ConsequenceEntry {
  consequence: string;
  regulation?: string;
}

/** The minimal finding shape the translator needs; works for scan + runtime findings. */
export interface ConsequenceFinding {
  ruleId: string;
  message: string;
}

/**
 * A plain-language consequence per rule the scanners can emit. Keep the tone
 * senior, specific, and money-&-reputation first — no severity scores, no jargon.
 * Every rule id is covered so consequences render with zero AI dependency.
 */
export const CONSEQUENCE_MAP: Record<string, ConsequenceEntry> = {
  // --- Supabase / data exposure ------------------------------------------------
  'supabase-rls': {
    consequence:
      "Anyone on the internet can read this table's rows right now — your customers' data is exposed and can be copied in seconds.",
    regulation: 'GDPR / CCPA',
  },
  'runtime-supabase-rls-open': {
    consequence:
      'We pulled real rows from your live database using only the public key — anyone can do the same and copy your customers\u2019 data. This is a live data breach.',
    regulation: 'GDPR / CCPA',
  },
  'runtime-supabase-key-exposed': {
    consequence:
      'Your app ships its database key in public code, so your database is reachable from any browser. If a single table is missing row-level security, anyone can read it — customer emails, orders, messages. Verify your app and we’ll show you exactly what’s exposed.',
    regulation: 'GDPR / CCPA',
  },
  'runtime-supabase-anon-write-implied': {
    consequence:
      'Because this table is wide open to reads with the public key, strangers can very likely also change or delete your data — corrupting orders, users, or content.',
    regulation: 'GDPR / CCPA',
  },
  'supabase-policy-permissive': {
    consequence:
      'A database access rule is set to "allow everyone", which quietly cancels your protection — treat this table as public until it is tightened.',
    regulation: 'GDPR / CCPA',
  },
  'supabase-storage-public-default': {
    consequence:
      'Your file storage is public by default, so uploaded documents, invoices, or user images can be opened by anyone with the link.',
    regulation: 'GDPR / CCPA',
  },
  'supabase-migration-auth-linked-no-rls': {
    consequence:
      'A table tied to your users was created without protection — accounts and their linked data can be read by anyone until it is locked down.',
    regulation: 'GDPR / CCPA',
  },
  'supabase-service-role-leak': {
    consequence:
      'Your all-powerful database admin key is reachable from the browser. Anyone who finds it can read, change, or wipe your entire database — no limits.',
    regulation: 'GDPR / CCPA',
  },

  // --- Secrets -----------------------------------------------------------------
  'runtime-secret-in-bundle': {
    consequence:
      "A secret key is visible in your app's public code. Anyone can copy it and run charges or access data as you — rotate it immediately.",
  },
  'stripe-secret-leak': {
    consequence:
      'Your Stripe secret key is exposed in the app. An attacker can issue refunds, read payment history, and move money as you. Rotate it now.',
  },
  'public-secret': {
    consequence:
      'A private credential is shipped to the browser where anyone can read it. Treat it as compromised and rotate it before it is abused.',
  },

  // --- Stripe / payments -------------------------------------------------------
  'stripe-webhook-signature': {
    consequence:
      'Anyone can send fake payment events to your app — they could unlock paid features or mark orders as paid without ever paying you.',
  },
  'stripe-webhook-no-idempotency': {
    consequence:
      'Repeated payment notifications can be processed twice, so customers may be charged again or granted double credit — refunds and angry emails follow.',
  },
  'stripe-live-key-in-dev': {
    consequence:
      'A real, live payment key is used in a non-production setup, risking real charges and refunds during testing — and a real key left where it can leak.',
  },
  'stripe-missing-subscription-events': {
    consequence:
      "Your app doesn't react to cancellations or failed payments, so people keep paid access after they stop paying — silent revenue leakage.",
  },

  // --- Auth boundary -----------------------------------------------------------
  'auth-route-handler-unprotected': {
    consequence:
      'An API endpoint runs without checking who is calling it — strangers can trigger it directly and reach data or actions meant for signed-in users only.',
  },
  'auth-server-action-no-check': {
    consequence:
      'A server action skips the login check, so anyone can invoke it and perform actions as if they were an authorized user.',
  },
  'auth-service-role-bypass': {
    consequence:
      'Code uses the database admin key to sidestep your access rules. A single bug here exposes everything, because the safety net is switched off.',
    regulation: 'GDPR / CCPA',
  },

  // --- AI app security ---------------------------------------------------------
  'ai-llm-key-in-client': {
    consequence:
      'Your AI provider key is exposed in the browser. Strangers can run your AI on your bill — expect a surprise invoice and possible abuse.',
  },
  'ai-route-missing-authz': {
    consequence:
      'Your AI endpoint has no access check, so anyone can call it and spend your AI credits or extract data — an open door to your costs.',
  },
  'ai-missing-rate-limit': {
    consequence:
      'There is no limit on how often your AI can be called, so one abuser (or a bot) can run up a huge bill or take the feature down for everyone.',
  },
  'ai-prompt-injection-surface': {
    consequence:
      'Untrusted text is fed straight into your AI, letting attackers hijack it to leak data or perform actions it should refuse.',
  },
  'ai-pii-to-model-context': {
    consequence:
      'Personal data is being sent into the AI model, which can store or expose it — a privacy risk and a likely compliance problem.',
    regulation: 'GDPR / CCPA',
  },

  // --- Runtime headers ---------------------------------------------------------
  'runtime-missing-security-headers': {
    consequence:
      'Your app is missing basic browser protections, making common attacks like clickjacking and content-sniffing easier against your users.',
  },

  // --- Data / RSC leaks --------------------------------------------------------
  'rsc-data-leaks': {
    consequence:
      'Server-side data can slip into the page sent to the browser, quietly exposing internal fields or secrets your users were never meant to see.',
  },
  'database-migration-safety': {
    consequence:
      'A database change looks risky and could drop or lock data during deploy — you may lose records or take the app down mid-release.',
  },

  // --- Config / operations -----------------------------------------------------
  'undocumented-env': {
    consequence:
      'A required setting is undocumented, so a teammate or future deploy can miss it and ship a broken or insecure app without noticing.',
  },
  'vercel-edge-node-mismatch': {
    consequence:
      'This code targets the wrong runtime and can crash or behave unpredictably once deployed — a broken feature for real users.',
  },
  'vercel-maxduration-missing': {
    consequence:
      'A long-running function has no time limit set, so it can be cut off mid-request or run up serverless costs — flaky behavior and surprise bills.',
  },
  'cold-start-optimization': {
    consequence:
      'The app is slow to wake up, so first-time visitors wait longer — hurting conversion and first impressions.',
  },
  'github-actions-integration': {
    consequence:
      'Your automated checks are not wired up, so risky changes can reach production without ever being scanned.',
  },
  'scan-completeness': {
    consequence:
      "The scan couldn't cover your whole app, so some risks may be hidden. Run a full scan before you trust a clean result.",
  },
  general: {
    consequence:
      'This issue can affect how safely or reliably your app runs for real users — review it before you ship.',
  },
};

/** Curated lookup only — synchronous and pure. Returns undefined for unknown rules. */
export function getCuratedConsequence(ruleId: string): ConsequenceEntry | undefined {
  return CONSEQUENCE_MAP[ruleId];
}

/** ShipGate groups key rule-based issues as "rule:<ruleId>". Extracts the rule id. */
export function ruleIdFromGroupKey(key: string): string | undefined {
  return key.startsWith('rule:') ? key.slice('rule:'.length) : undefined;
}

/** Convenience: curated consequence for a ShipGate group key, when it is rule-based. */
export function consequenceForGroupKey(key: string): ConsequenceEntry | undefined {
  const ruleId = ruleIdFromGroupKey(key);
  return ruleId ? getCuratedConsequence(ruleId) : undefined;
}
