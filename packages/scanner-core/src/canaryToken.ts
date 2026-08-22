/**
 * Assurly canary tokens — planted credentials that alert when used.
 *
 * Prefix is load-bearing: our own secret scanners must recognise a planted
 * canary and classify it as informational, never as a leak. See the conflict
 * note in the Phase 3 dependency-provenance / canary ship gate.
 *
 * Format: `ask_canary_<base64url body>` (body ≥ 16 chars).
 */

/** Distinctive, documented prefix. Do not change without a migration path. */
export const ASSURLY_CANARY_PREFIX = 'ask_canary_';

/** Env key for the HTTPS tripwire URL. Never a real service URL. */
export const ASSURLY_CANARY_ENV_KEY = 'ASSURLY_CANARY_URL';

/** Path prefix of the public hit callback (`/api/canary/<token>`). */
export const ASSURLY_CANARY_CALLBACK_PATH = '/api/canary/';

const CANARY_BODY_PATTERN = /^[A-Za-z0-9_-]{16,}$/;
const FULL_CANARY_PATTERN = /^ask_canary_[A-Za-z0-9_-]{16,}$/;

/** Matches a canary token anywhere in a string (for line/bundle scans). */
export const ASSURLY_CANARY_IN_TEXT = /ask_canary_[A-Za-z0-9_-]{16,}/g;

/** True when the whole string is a well-formed Assurly canary token. */
export function isAssurlyCanaryToken(candidate: string): boolean {
  return FULL_CANARY_PATTERN.test(candidate.trim());
}

/** True when the text contains at least one Assurly canary token. */
export function containsAssurlyCanaryToken(text: string): boolean {
  ASSURLY_CANARY_IN_TEXT.lastIndex = 0;
  return ASSURLY_CANARY_IN_TEXT.test(text);
}

/** Extracts the first canary token from text, or null. */
export function extractAssurlyCanaryToken(text: string): string | null {
  ASSURLY_CANARY_IN_TEXT.lastIndex = 0;
  const match = ASSURLY_CANARY_IN_TEXT.exec(text);
  return match?.[0] ?? null;
}

/** Validates the body portion (without prefix). */
export function isAssurlyCanaryBody(body: string): boolean {
  return CANARY_BODY_PATTERN.test(body);
}

/** True when the env key is the dedicated tripwire key. */
export function isAssurlyCanaryEnvKey(key: string): boolean {
  return key.trim() === ASSURLY_CANARY_ENV_KEY;
}

/** True when the text includes the public canary callback path. */
export function containsAssurlyCanaryCallbackPath(text: string): boolean {
  return text.includes(ASSURLY_CANARY_CALLBACK_PATH);
}

/** True when an MCP server URL is the Assurly tripwire (decoy, not a real MCP host). */
export function isAssurlyCanaryMcpUrl(url: string): boolean {
  return containsAssurlyCanaryCallbackPath(url) || containsAssurlyCanaryToken(url);
}

/**
 * Append the env snippet to `.env.example` unless a canary line is already
 * present. Pure string merge — callers own the filesystem.
 */
export function mergeCanaryPlantIntoEnvExample(
  existing: string,
  snippet: string,
): { content: string; changed: boolean } {
  const hasPlant = existing.split(/\r?\n/).some((line) => isAssurlyCanaryPlantLine(line));
  if (hasPlant) return { content: existing, changed: false };
  const trimmedSnippet = snippet.trim();
  if (!trimmedSnippet) return { content: existing, changed: false };
  if (existing.includes(trimmedSnippet)) return { content: existing, changed: false };
  const prefix = existing.length === 0 ? '' : existing.endsWith('\n') ? existing : `${existing}\n`;
  return { content: `${prefix}${trimmedSnippet}\n`, changed: true };
}

/**
 * True when an env/example line is an Assurly tripwire — token, callback URL,
 * or the dedicated env key. Those lines are informational, never a leak.
 */
export function isAssurlyCanaryPlantLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return false;
  const key = trimmed.split('=')[0]?.trim() ?? '';
  return (
    isAssurlyCanaryEnvKey(key) ||
    containsAssurlyCanaryToken(trimmed) ||
    containsAssurlyCanaryCallbackPath(trimmed)
  );
}
