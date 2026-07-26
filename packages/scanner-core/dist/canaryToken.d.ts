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
