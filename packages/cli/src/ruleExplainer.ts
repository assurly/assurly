import { HIGH_CONFIDENCE_BLOCKER_RULE_IDS } from '@shipready/scanner-core';
import { allRules } from './rules';

export interface RuleExplanation {
  ruleId: string;
  title: string;
  explanation: string;
  howToFix: string;
  blocksShip: boolean;
}

const SCANNER_RULE_EXPLANATIONS: Record<
  string,
  Pick<RuleExplanation, 'title' | 'explanation' | 'howToFix'>
> = {
  'supabase-rls': {
    title: 'Supabase table missing Row-Level Security',
    explanation:
      'A Supabase table was created in SQL migrations without enabling Row-Level Security (RLS). Without RLS, authenticated clients can read or write rows they should not access.',
    howToFix:
      'Add `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;` in your migration, then create explicit policies for each role that needs access.',
  },
  'supabase-service-role-leak': {
    title: 'Supabase service role exposed to the client',
    explanation:
      'The Supabase service role key bypasses RLS and must never ship to browser or client bundles.',
    howToFix:
      'Move service-role usage to server-only code (Route Handlers, Server Actions, or Edge Functions) and keep only the anon key on the client.',
  },
  'supabase-policy-permissive': {
    title: 'Overly permissive Supabase RLS policy',
    explanation:
      'An RLS policy uses `USING (true)` or `WITH CHECK (true)`, which effectively grants unrestricted access.',
    howToFix:
      'Replace blanket policies with predicates tied to `auth.uid()` or tenant identifiers so users only access their own rows.',
  },
  'supabase-migration-auth-linked-no-rls': {
    title: 'Auth-linked table without RLS',
    explanation:
      'A migration references Supabase auth helpers but the table still lacks RLS, leaving user data exposed.',
    howToFix:
      'Enable RLS on the table and add policies scoped to the authenticated user or tenant.',
  },
  'stripe-webhook-signature': {
    title: 'Stripe webhook signature not verified',
    explanation:
      'Webhook handlers must verify `Stripe-Signature` before processing events; otherwise attackers can forge payment events.',
    howToFix:
      'Call `stripe.webhooks.constructEvent(payload, signature, webhookSecret)` and reject invalid signatures with HTTP 400.',
  },
  'stripe-secret-leak': {
    title: 'Stripe secret key exposed',
    explanation: 'A Stripe secret key appears in client-visible code or a public env variable.',
    howToFix:
      'Load `STRIPE_SECRET_KEY` only on the server and keep publishable keys in `NEXT_PUBLIC_*` when needed.',
  },
  'undocumented-env': {
    title: 'Undocumented environment variable',
    explanation:
      'Code references `process.env.*` variables that are missing from `.env.example`, making deploys fail silently.',
    howToFix:
      'Add each required variable to `.env.example` with an empty placeholder and document its purpose.',
  },
  'public-secret': {
    title: 'Secret referenced from a public env prefix',
    explanation:
      'A sensitive value uses `NEXT_PUBLIC_*` or similar, which embeds it in the browser bundle.',
    howToFix: 'Rename to a server-only env var and read it exclusively from server-side code.',
  },
  'database-migration-safety': {
    title: 'Unsafe SQL migration',
    explanation:
      'Adding a NOT NULL column without a DEFAULT breaks populated tables at deploy time.',
    howToFix:
      'Backfill existing rows, add a DEFAULT, or use a multi-step migration before enforcing NOT NULL.',
  },
  'rsc-data-leaks': {
    title: 'Client component imports server-only module',
    explanation:
      'A `"use client"` file imports server-only code, which can leak secrets or break the RSC boundary.',
    howToFix:
      'Move server logic behind a Server Action or Route Handler and pass only serializable props to the client component.',
  },
  'cold-start-optimization': {
    title: 'Heavy serverless route',
    explanation:
      'An API route imports large dependencies or performs expensive work that increases cold-start latency and cost.',
    howToFix:
      'Split heavy imports, lazy-load optional modules, or move work to a background job or edge-compatible path.',
  },
  'vercel-edge-node-mismatch': {
    title: 'Edge runtime incompatible dependency',
    explanation:
      'A route marked `runtime = "edge"` imports Node-only APIs or packages that cannot run on Edge.',
    howToFix:
      'Remove Node-only imports, switch the route to the Node runtime, or refactor to edge-compatible APIs.',
  },
  'github-actions-integration': {
    title: 'Missing ShipReady CI workflow',
    explanation:
      'No GitHub Actions workflow runs ShipReady before deploy, so regressions can ship unnoticed.',
    howToFix: 'Run `npx shipready init` to add `.github/workflows/shipready.yml` with a scan step.',
  },
  'auth-service-role-bypass': {
    title: 'Service role used without authorization guard',
    explanation:
      'Server code creates a Supabase client with the service role but lacks an explicit auth check before privileged queries.',
    howToFix:
      'Verify the caller session or signed token before using the service role, and prefer user-scoped clients when RLS suffices.',
  },
  'ai-llm-key-in-client': {
    title: 'LLM API key in client code',
    explanation: 'An LLM provider key is reachable from browser bundles, allowing quota theft.',
    howToFix: 'Proxy model calls through a server route with authentication and rate limits.',
  },
};

const blockerRuleIds = new Set<string>(HIGH_CONFIDENCE_BLOCKER_RULE_IDS);

function explanationFromCliRule(ruleId: string): RuleExplanation | null {
  const rule = allRules.find((candidate) => candidate.id === ruleId);
  if (!rule) return null;
  return {
    ruleId,
    title: rule.name,
    explanation: rule.description,
    howToFix: `Review findings for rule "${rule.id}" and apply the suggested remediation in the scan output.`,
    blocksShip: rule.severity === 'error',
  };
}

export function explainRule(ruleId: string): RuleExplanation | null {
  const normalized = ruleId.trim();
  if (!normalized) return null;

  const scannerRule = SCANNER_RULE_EXPLANATIONS[normalized];
  if (scannerRule) {
    return {
      ruleId: normalized,
      ...scannerRule,
      blocksShip: blockerRuleIds.has(normalized),
    };
  }

  return explanationFromCliRule(normalized);
}
