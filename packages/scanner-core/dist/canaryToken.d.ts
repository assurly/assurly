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
export declare const ASSURLY_CANARY_PREFIX = "ask_canary_";
/** Env key for the HTTPS tripwire URL. Never a real service URL. */
export declare const ASSURLY_CANARY_ENV_KEY = "ASSURLY_CANARY_URL";
/** Path prefix of the public hit callback (`/api/canary/<token>`). */
export declare const ASSURLY_CANARY_CALLBACK_PATH = "/api/canary/";
/** Matches a canary token anywhere in a string (for line/bundle scans). */
export declare const ASSURLY_CANARY_IN_TEXT: RegExp;
/** True when the whole string is a well-formed Assurly canary token. */
export declare function isAssurlyCanaryToken(candidate: string): boolean;
/** True when the text contains at least one Assurly canary token. */
export declare function containsAssurlyCanaryToken(text: string): boolean;
/** Extracts the first canary token from text, or null. */
export declare function extractAssurlyCanaryToken(text: string): string | null;
/** Validates the body portion (without prefix). */
export declare function isAssurlyCanaryBody(body: string): boolean;
/** True when the env key is the dedicated tripwire key. */
export declare function isAssurlyCanaryEnvKey(key: string): boolean;
/** True when the text includes the public canary callback path. */
export declare function containsAssurlyCanaryCallbackPath(text: string): boolean;
/** True when an MCP server URL is the Assurly tripwire (decoy, not a real MCP host). */
export declare function isAssurlyCanaryMcpUrl(url: string): boolean;
/**
 * Append the env snippet to `.env.example` unless a canary line is already
 * present. Pure string merge — callers own the filesystem.
 */
export declare function mergeCanaryPlantIntoEnvExample(existing: string, snippet: string): {
    content: string;
    changed: boolean;
};
/**
 * True when an env/example line is an Assurly tripwire — token, callback URL,
 * or the dedicated env key. Those lines are informational, never a leak.
 */
export declare function isAssurlyCanaryPlantLine(line: string): boolean;
