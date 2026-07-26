"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.explainRule = explainRule;
const scanner_core_1 = require("@assurly/scanner-core");
const rules_1 = require("./rules");
const SCANNER_RULE_EXPLANATIONS = {
    'supabase-rls': {
        title: 'Supabase table missing Row-Level Security',
        explanation: 'A Supabase table was created in SQL migrations without enabling Row-Level Security (RLS). Without RLS, authenticated clients can read or write rows they should not access.',
        howToFix: 'Add `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;` in your migration, then create explicit policies for each role that needs access.',
    },
    'supabase-service-role-leak': {
        title: 'Supabase service role exposed to the client',
        explanation: 'The Supabase service role key bypasses RLS and must never ship to browser or client bundles.',
        howToFix: 'Move service-role usage to server-only code (Route Handlers, Server Actions, or Edge Functions) and keep only the anon key on the client.',
    },
    'supabase-policy-permissive': {
        title: 'Overly permissive Supabase RLS policy',
        explanation: 'An RLS policy uses `USING (true)` or `WITH CHECK (true)`, which effectively grants unrestricted access.',
        howToFix: 'Replace blanket policies with predicates tied to `auth.uid()` or tenant identifiers so users only access their own rows.',
    },
    'supabase-migration-auth-linked-no-rls': {
        title: 'Auth-linked table without RLS',
        explanation: 'A migration references Supabase auth helpers but the table still lacks RLS, leaving user data exposed.',
        howToFix: 'Enable RLS on the table and add policies scoped to the authenticated user or tenant.',
    },
    'stripe-webhook-signature': {
        title: 'Stripe webhook signature not verified',
        explanation: 'Webhook handlers must verify `Stripe-Signature` before processing events; otherwise attackers can forge payment events.',
        howToFix: 'Call `stripe.webhooks.constructEvent(payload, signature, webhookSecret)` and reject invalid signatures with HTTP 400.',
    },
    'stripe-secret-leak': {
        title: 'Stripe secret key exposed',
        explanation: 'A Stripe secret key appears in client-visible code or a public env variable.',
        howToFix: 'Load `STRIPE_SECRET_KEY` only on the server and keep publishable keys in `NEXT_PUBLIC_*` when needed.',
    },
    'undocumented-env': {
        title: 'Undocumented environment variable',
        explanation: 'Code references `process.env.*` variables that are missing from `.env.example`, making deploys fail silently.',
        howToFix: 'Add each required variable to `.env.example` with an empty placeholder and document its purpose.',
    },
    'public-secret': {
        title: 'Secret referenced from a public env prefix',
        explanation: 'A sensitive value uses `NEXT_PUBLIC_*` or similar, which embeds it in the browser bundle.',
        howToFix: 'Rename to a server-only env var and read it exclusively from server-side code.',
    },
    'database-migration-safety': {
        title: 'Unsafe SQL migration',
        explanation: 'Adding a NOT NULL column without a DEFAULT breaks populated tables at deploy time.',
        howToFix: 'Backfill existing rows, add a DEFAULT, or use a multi-step migration before enforcing NOT NULL.',
    },
    'rsc-data-leaks': {
        title: 'Client component imports server-only module',
        explanation: 'A `"use client"` file imports server-only code, which can leak secrets or break the RSC boundary.',
        howToFix: 'Move server logic behind a Server Action or Route Handler and pass only serializable props to the client component.',
    },
    'cold-start-optimization': {
        title: 'Heavy serverless route',
        explanation: 'An API route imports large dependencies or performs expensive work that increases cold-start latency and cost.',
        howToFix: 'Split heavy imports, lazy-load optional modules, or move work to a background job or edge-compatible path.',
    },
    'vercel-edge-node-mismatch': {
        title: 'Edge runtime incompatible dependency',
        explanation: 'A route marked `runtime = "edge"` imports Node-only APIs or packages that cannot run on Edge.',
        howToFix: 'Remove Node-only imports, switch the route to the Node runtime, or refactor to edge-compatible APIs.',
    },
    'github-actions-integration': {
        title: 'Missing Assurly CI workflow',
        explanation: 'No GitHub Actions workflow runs Assurly before deploy, so regressions can ship unnoticed.',
        howToFix: 'Run `npx assurly init` to add `.github/workflows/assurly.yml` with a scan step.',
    },
    'auth-service-role-bypass': {
        title: 'Service role used without authorization guard',
        explanation: 'Server code creates a Supabase client with the service role but lacks an explicit auth check before privileged queries.',
        howToFix: 'Verify the caller session or signed token before using the service role, and prefer user-scoped clients when RLS suffices.',
    },
    'ai-llm-key-in-client': {
        title: 'LLM API key in client code',
        explanation: 'An LLM provider key is reachable from browser bundles, allowing quota theft.',
        howToFix: 'Proxy model calls through a server route with authentication and rate limits.',
    },
    'agent-mcp-unpinned-version': {
        title: 'MCP package installed without a pinned version',
        explanation: 'An MCP server is launched via npx/bunx/pnpm dlx without `@version`, so a later publish can change behaviour without you noticing.',
        howToFix: 'Pin the package version in the MCP args (e.g. `@org/server@1.2.3`).',
    },
    'agent-mcp-shell-execution': {
        title: 'MCP server runs through a shell',
        explanation: 'The MCP config invokes bash/sh/zsh/curl/wget/eval (or pipes into a shell), which can execute arbitrary commands from the agent session.',
        howToFix: 'Point the MCP entry at a dedicated executable or package runner, not a raw shell.',
    },
    'agent-mcp-insecure-endpoint': {
        title: 'MCP server uses insecure remote HTTP',
        explanation: 'A remote MCP `url` uses `http://` to a non-loopback host, so tool traffic and credentials can be intercepted.',
        howToFix: 'Use `https://` for remote endpoints, or `http://` only for localhost/127.0.0.1.',
    },
    'agent-mcp-inline-secret': {
        title: 'Live credential embedded in MCP config',
        explanation: 'An `env` value in the MCP config looks like a live credential. These files are often committed or synced across machines.',
        howToFix: 'Replace the literal with a placeholder and load the secret from the environment or a secret manager.',
    },
    'agent-mcp-unscoped-package': {
        title: 'MCP server uses an unscoped package',
        explanation: 'The MCP package name has no `@org/` scope, which makes typosquatting and mistaken installs easier.',
        howToFix: 'Prefer a scoped package from a known publisher when one is available.',
    },
    'agent-hidden-instruction': {
        title: 'Hidden instruction in an agent-readable file',
        explanation: 'Instruction-like text is concealed in an HTML comment or with zero-width characters — invisible to readers but still seen by models.',
        howToFix: 'Move agent instructions into visible prose, or remove the hidden directive.',
    },
    'agent-instruction-override': {
        title: 'Instruction file tries to override the agent',
        explanation: 'The file contains phrasing that attempts to discard prior instructions or hide actions from the user.',
        howToFix: 'Remove override/jailbreak phrasing from project instruction files.',
    },
    'agent-exfiltration-directive': {
        title: 'Instruction file directs secret exfiltration',
        explanation: 'Secret-related terms appear next to a network send directive (POST/send/curl), a common exfiltration pattern in poisoned docs.',
        howToFix: 'Remove directives that tell the agent to send credentials or `.env` contents to a remote endpoint.',
    },
    'supply-install-scripts-unreviewed': {
        title: 'Install scripts present without an allowScripts allowlist',
        explanation: 'The lockfile marks packages with hasInstallScript, but root package.json has no allowScripts and .npmrc does not set ignore-scripts=true. Under npm 12 those scripts are blocked by default — without an allowlist you have not recorded which ones you trust.',
        howToFix: 'Run `npm install-scripts --allow-scripts-pending`, then pin exact versions in root package.json allowScripts (or set ignore-scripts=true if you intend to run none).',
    },
    'supply-allowscripts-unpinned': {
        title: 'allowScripts entry is not pinned to an exact version',
        explanation: 'A bare package name or `name@*` in allowScripts grants install-script execution to every version forever — including a release published tomorrow after a package takeover.',
        howToFix: 'Pin an exact version (e.g. `"pkg@1.2.3": true`). Avoid bare names and `name@*`.',
    },
    'supply-allowscripts-stale': {
        title: 'allowScripts lists a package not in the lockfile',
        explanation: 'A dead allowlist entry is not merely untidy. If that name is later re-added — by an agent recalling a package it once used, or by someone registering an abandoned name (see dep-slopsquat-suspect) — it installs with script execution already approved.',
        howToFix: 'Remove stale keys with `npm install-scripts prune`, or delete the entry by hand.',
    },
    'supply-allowscripts-invalid': {
        title: 'allowScripts key is silently dropped by npm',
        explanation: 'npm rejects allowScripts keys that use ranges (^/~/>=/<) or dist-tags (latest/next). The author believes the entry grants something it does not.',
        howToFix: 'Use a bare name, `name@*`, or exact versions joined by `||` (e.g. `"pkg@1.0.0||2.0.0": true`).',
    },
    'supply-allowscripts-in-workspace': {
        title: 'allowScripts declared in a workspace package',
        explanation: 'npm only reads allowScripts from the workspace root. A sub-workspace declaration is silently ignored.',
        howToFix: 'Move the allowScripts map into the root package.json, then remove it from the workspace package.',
    },
    'supply-non-registry-dependency': {
        title: 'Non-registry dependency (git / URL / tarball)',
        explanation: 'A dependency comes from git, a URL, or a remote tarball. npm 12 blocks those by default unless allow-git / allow-remote is set deliberately.',
        howToFix: 'Prefer a registry package with a pinned version. If the non-registry source is intentional, set the matching npm allow flag on purpose — not because an agent needed the install to succeed.',
    },
    'supply-npm-below-v12': {
        title: 'Project permits npm below 12',
        explanation: 'packageManager or engines.npm allows npm below 12, so install-script allowlisting and related defaults do not apply.',
        howToFix: 'Pin npm 12+, e.g. `"packageManager": "npm@12.0.1"` or `"engines": { "npm": ">=12" }`.',
    },
    'dep-nonexistent-package': {
        title: 'Dependency does not exist on npm',
        explanation: 'A newly added dependency has never been published to the npm registry. AI models sometimes hallucinate plausible package names; installing one fails the build and can be pre-registered by an attacker.',
        howToFix: 'Remove the package or replace it with the real name you intended. Confirm the package at registry.npmjs.org before merging.',
    },
    'dep-typosquat-suspect': {
        title: 'Suspected typosquat dependency',
        explanation: 'A newly added dependency is young, barely downloaded, and within edit distance 2 of a popular package name — a classic typosquat of a real package.',
        howToFix: 'Verify the publisher and the intended package name. If you meant the popular neighbour named in the finding, fix the typo rather than installing the lookalike.',
    },
    'dep-slopsquat-suspect': {
        title: 'Suspected slopsquat dependency',
        explanation: 'A newly added dependency borrows a popular package name, has only one published version with no repository, and almost no downloads — the shape of an AI-hallucinated name that was pre-registered (or a defensive placeholder with the same shape).',
        howToFix: 'Confirm the publisher and source. Prefer the real package behind the borrowed name. Age alone is not proof of safety — pre-registered squats wait.',
    },
    'dep-new-unvetted': {
        title: 'Young, low-adoption dependency',
        explanation: 'A newly added dependency was published recently and has very few weekly downloads. That alone is not proof of malice, but it deserves a second look before merge.',
        howToFix: 'Confirm the package source and publisher. Prefer well-known packages when an equivalent exists.',
    },
    'dep-registry-unavailable': {
        title: 'npm registry lookup unavailable',
        explanation: 'Assurly could not verify the package against the npm registry (timeout, outage, or rate limit). The PR check continues without blocking on provenance.',
        howToFix: 'Retry the check later, or manually confirm the package exists on registry.npmjs.org before merging.',
    },
    'assurly-canary-planted': {
        title: 'Assurly canary token (intentional)',
        explanation: 'An Assurly canary token (`ask_canary_…`) was found. This is an intentional tripwire you planted — not a leaked credential. Assurly alerts if the token is ever used.',
        howToFix: 'Keep the canary planted. If you receive a canary-hit alert, treat nearby real secrets as compromised and rotate them.',
    },
};
const blockerRuleIds = new Set(scanner_core_1.HIGH_CONFIDENCE_BLOCKER_RULE_IDS);
function explanationFromCliRule(ruleId) {
    const rule = rules_1.allRules.find((candidate) => candidate.id === ruleId);
    if (!rule)
        return null;
    return {
        ruleId,
        title: rule.name,
        explanation: rule.description,
        howToFix: `Review findings for rule "${rule.id}" and apply the suggested remediation in the scan output.`,
        blocksShip: rule.severity === 'error',
    };
}
function explainRule(ruleId) {
    const normalized = ruleId.trim();
    if (!normalized)
        return null;
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
