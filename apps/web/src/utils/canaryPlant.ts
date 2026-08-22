/**
 * Client-safe canary plant helpers (no Node crypto).
 *
 * The tripwire is an HTTPS callback URL under ASSURLY_CANARY_URL — never a
 * lookalike Stripe, Supabase, or database secret.
 */
import { ASSURLY_CANARY_CALLBACK_PATH, ASSURLY_CANARY_ENV_KEY } from '@assurly/scanner-core';
import { SITE_ORIGIN } from './siteMetadata';

export const CANARY_SNIPPET_FORBIDDEN_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'STRIPE_SECRET_KEY',
  'DATABASE_URL',
] as const;

export const CANARY_HIT_ROTATE_COPY =
  'Someone fetched your tripwire. Rotate the real Stripe, Supabase, and GitHub secrets on this target — not the canary URL.';

export const CANARY_PLANT_HINT =
  'Paste the env lines into .env.example. Optionally add the decoy MCP block to .cursor/mcp.json — do not enable that server in Cursor (add assurly-cloud-auth to disabledMcpjsonServers). This is a tripwire URL, not a real service.';

export const CANARY_SILENT_ALARM_LABEL = 'Silent alarm';

/** Tempting decoy MCP server name. Must stay disabled in the operator's Cursor. */
export const ASSURLY_CANARY_MCP_SERVER_NAME = 'assurly-cloud-auth';

export const CANARY_MCP_DISABLE_HINT =
  'Do not enable this server in Cursor. Add "assurly-cloud-auth" to disabledMcpjsonServers so your own agent does not trip the alarm.';

/** Public origin attackers will fetch. Loopback APP_URL is never plantable. */
export function resolveCanaryCallbackOrigin(applicationUrl: string): string {
  try {
    const url = new URL(applicationUrl);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') {
      return SITE_ORIGIN;
    }
    return url.origin;
  } catch {
    return SITE_ORIGIN;
  }
}

export function buildCanaryCallbackUrl(origin: string, plaintext: string): string {
  const base = origin.replace(/\/$/, '');
  return `${base}${ASSURLY_CANARY_CALLBACK_PATH}${encodeURIComponent(plaintext)}`;
}

export function buildCanaryPlantSnippet(callbackUrl: string): string {
  return [
    '# Assurly silent alarm — tripwire only. Do not copy into production .env as a real service URL.',
    '# If this URL is fetched, Assurly alerts you. Rotate real Stripe, Supabase, and GitHub secrets — not this value.',
    `${ASSURLY_CANARY_ENV_KEY}=${callbackUrl}`,
  ].join('\n');
}

export function buildCanaryMcpDecoySnippet(callbackUrl: string): string {
  const config = {
    mcpServers: {
      [ASSURLY_CANARY_MCP_SERVER_NAME]: { url: callbackUrl },
    },
  };
  return [`// ${CANARY_MCP_DISABLE_HINT}`, JSON.stringify(config, null, 2)].join('\n');
}

export function buildCanaryCopyPayload(envSnippet: string, mcpSnippet: string): string {
  return [envSnippet.trimEnd(), '', mcpSnippet.trimEnd()].join('\n');
}

export function canarySnippetUsesSafeKey(snippet: string): boolean {
  return CANARY_SNIPPET_FORBIDDEN_KEYS.every((key) => !snippet.includes(`${key}=`));
}
