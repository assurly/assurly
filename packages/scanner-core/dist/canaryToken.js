"use strict";
/**
 * Assurly canary tokens — planted credentials that alert when used.
 *
 * Prefix is load-bearing: our own secret scanners must recognise a planted
 * canary and classify it as informational, never as a leak. See the conflict
 * note in the Phase 3 dependency-provenance / canary ship gate.
 *
 * Format: `ask_canary_<base64url body>` (body ≥ 16 chars).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASSURLY_CANARY_IN_TEXT = exports.ASSURLY_CANARY_PREFIX = void 0;
exports.isAssurlyCanaryToken = isAssurlyCanaryToken;
exports.containsAssurlyCanaryToken = containsAssurlyCanaryToken;
exports.extractAssurlyCanaryToken = extractAssurlyCanaryToken;
exports.isAssurlyCanaryBody = isAssurlyCanaryBody;
/** Distinctive, documented prefix. Do not change without a migration path. */
exports.ASSURLY_CANARY_PREFIX = 'ask_canary_';
const CANARY_BODY_PATTERN = /^[A-Za-z0-9_-]{16,}$/;
const FULL_CANARY_PATTERN = /^ask_canary_[A-Za-z0-9_-]{16,}$/;
/** Matches a canary token anywhere in a string (for line/bundle scans). */
exports.ASSURLY_CANARY_IN_TEXT = /ask_canary_[A-Za-z0-9_-]{16,}/g;
/** True when the whole string is a well-formed Assurly canary token. */
function isAssurlyCanaryToken(candidate) {
    return FULL_CANARY_PATTERN.test(candidate.trim());
}
/** True when the text contains at least one Assurly canary token. */
function containsAssurlyCanaryToken(text) {
    exports.ASSURLY_CANARY_IN_TEXT.lastIndex = 0;
    return exports.ASSURLY_CANARY_IN_TEXT.test(text);
}
/** Extracts the first canary token from text, or null. */
function extractAssurlyCanaryToken(text) {
    exports.ASSURLY_CANARY_IN_TEXT.lastIndex = 0;
    const match = exports.ASSURLY_CANARY_IN_TEXT.exec(text);
    return match?.[0] ?? null;
}
/** Validates the body portion (without prefix). */
function isAssurlyCanaryBody(body) {
    return CANARY_BODY_PATTERN.test(body);
}
