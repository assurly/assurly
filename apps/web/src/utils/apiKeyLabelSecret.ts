/**
 * Heuristic: does a user-typed API key *label* look like a pasted secret?
 *
 * Labels are stored in plaintext and shown in the dashboard — warn (never
 * hard-block) when the value matches common secret shapes so a live key is not
 * accidentally persisted as a label.
 */

const KNOWN_SECRET_PREFIXES = [
  'sk-ant-',
  'sk-',
  'ghp_',
  'gho_',
  'github_pat_',
  'xoxb-',
  'AKIA',
] as const;

/** 40+ chars, no whitespace, mixes upper + lower + digit (high-entropy token). */
const HIGH_ENTROPY_TOKEN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)\S{40,}$/;

export function apiKeyLabelLooksLikeSecret(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) {
    return false;
  }

  for (const prefix of KNOWN_SECRET_PREFIXES) {
    if (trimmed.includes(prefix)) {
      return true;
    }
  }

  // Split on whitespace so a long sentence never trips the entropy rule as one blob.
  return trimmed.split(/\s+/).some((token) => HIGH_ENTROPY_TOKEN.test(token));
}
