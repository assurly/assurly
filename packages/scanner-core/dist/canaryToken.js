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
exports.ASSURLY_CANARY_IN_TEXT = exports.ASSURLY_CANARY_CALLBACK_PATH = exports.ASSURLY_CANARY_ENV_KEY = exports.ASSURLY_CANARY_PREFIX = void 0;
exports.isAssurlyCanaryToken = isAssurlyCanaryToken;
exports.containsAssurlyCanaryToken = containsAssurlyCanaryToken;
exports.extractAssurlyCanaryToken = extractAssurlyCanaryToken;
exports.isAssurlyCanaryBody = isAssurlyCanaryBody;
exports.isAssurlyCanaryEnvKey = isAssurlyCanaryEnvKey;
exports.containsAssurlyCanaryCallbackPath = containsAssurlyCanaryCallbackPath;
exports.isAssurlyCanaryMcpUrl = isAssurlyCanaryMcpUrl;
exports.mergeCanaryPlantIntoEnvExample = mergeCanaryPlantIntoEnvExample;
exports.isAssurlyCanaryPlantLine = isAssurlyCanaryPlantLine;
/** Distinctive, documented prefix. Do not change without a migration path. */
exports.ASSURLY_CANARY_PREFIX = 'ask_canary_';
/** Env key for the HTTPS tripwire URL. Never a real service URL. */
exports.ASSURLY_CANARY_ENV_KEY = 'ASSURLY_CANARY_URL';
/** Path prefix of the public hit callback (`/api/canary/<token>`). */
exports.ASSURLY_CANARY_CALLBACK_PATH = '/api/canary/';
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
/** True when the env key is the dedicated tripwire key. */
function isAssurlyCanaryEnvKey(key) {
    return key.trim() === exports.ASSURLY_CANARY_ENV_KEY;
}
/** True when the text includes the public canary callback path. */
function containsAssurlyCanaryCallbackPath(text) {
    return text.includes(exports.ASSURLY_CANARY_CALLBACK_PATH);
}
/** True when an MCP server URL is the Assurly tripwire (decoy, not a real MCP host). */
function isAssurlyCanaryMcpUrl(url) {
    return containsAssurlyCanaryCallbackPath(url) || containsAssurlyCanaryToken(url);
}
/**
 * Append the env snippet to `.env.example` unless a canary line is already
 * present. Pure string merge — callers own the filesystem.
 */
function mergeCanaryPlantIntoEnvExample(existing, snippet) {
    const hasPlant = existing.split(/\r?\n/).some((line) => isAssurlyCanaryPlantLine(line));
    if (hasPlant)
        return { content: existing, changed: false };
    const trimmedSnippet = snippet.trim();
    if (!trimmedSnippet)
        return { content: existing, changed: false };
    if (existing.includes(trimmedSnippet))
        return { content: existing, changed: false };
    const prefix = existing.length === 0 ? '' : existing.endsWith('\n') ? existing : `${existing}\n`;
    return { content: `${prefix}${trimmedSnippet}\n`, changed: true };
}
/**
 * True when an env/example line is an Assurly tripwire — token, callback URL,
 * or the dedicated env key. Those lines are informational, never a leak.
 */
function isAssurlyCanaryPlantLine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#'))
        return false;
    const key = trimmed.split('=')[0]?.trim() ?? '';
    return (isAssurlyCanaryEnvKey(key) ||
        containsAssurlyCanaryToken(trimmed) ||
        containsAssurlyCanaryCallbackPath(trimmed));
}
