/**
 * The "we were refused, so we know nothing" outcome of a runtime URL scan.
 *
 * A target that answers 401/403/429 is protected or rate-limited, NOT dead, and
 * it is not judged either way: no findings, no Ship Score. Emitting a verdict
 * here would be a guess in one direction (a WAF-protected app failing for being
 * protected) or the other (a green score for a page we never saw).
 *
 * Kept free of server-only imports so the dashboard can render the copy.
 */

/** Who refused the runtime scanner, when the response identifies them. */
export type BlockedScanSource = 'cloudflare' | 'vercel' | 'rate-limit' | 'unknown';

export interface BlockedScan {
  status: number;
  source: BlockedScanSource;
}

export interface BlockedScanCopy {
  title: string;
  detail: string;
  nextStep: string;
}

/**
 * Sent on every runtime probe so a host can tell Assurly apart from an
 * anonymous crawler and allowlist it. The User-Agent cannot carry this: bot
 * protection challenges any non-mainstream User-Agent token, which is exactly
 * how a live, healthy app ends up looking unreachable.
 */
export const SCANNER_IDENTITY_HEADER = 'X-Assurly-Scanner';

const BLOCKED_SCAN_SOURCES = new Set<string>([
  'cloudflare',
  'vercel',
  'rate-limit',
  'unknown',
] satisfies BlockedScanSource[]);

/** Narrows an untrusted API payload to a `BlockedScan`, or `null` if it is not one. */
export function parseBlockedScan(raw: unknown): BlockedScan | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.status !== 'number' || !Number.isInteger(record.status)) return null;
  if (typeof record.source !== 'string' || !BLOCKED_SCAN_SOURCES.has(record.source)) return null;
  return { status: record.status, source: record.source as BlockedScanSource };
}

/**
 * Explains the refusal in the user's terms. Every variant must make clear that
 * this says nothing about the app's security — the point of the honest-unknown
 * state is that the user does not read it as either a pass or a failure.
 */
export function describeBlockedScan(blocked: BlockedScan): BlockedScanCopy {
  const allowlistStep = `Verify ownership of this URL, or allowlist requests carrying the ${SCANNER_IDENTITY_HEADER} header on your host, then scan again.`;

  switch (blocked.source) {
    case 'cloudflare':
      return {
        title: 'Cloudflare blocked the scan',
        detail: `Your app answered, but Cloudflare's bot protection challenged our probe with HTTP ${blocked.status}. Your app is running — we were simply never allowed to look at it.`,
        nextStep: allowlistStep,
      };
    case 'vercel':
      return {
        title: 'Deployment protection blocked the scan',
        detail: `This deployment demands authentication (HTTP ${blocked.status}), so our probe never reached your app. Vercel applies this to preview URLs by default.`,
        nextStep: allowlistStep,
      };
    case 'rate-limit':
      return {
        title: 'The target rate-limited the scan',
        detail: `Your host answered HTTP ${blocked.status} (too many requests) and turned our probe away before it could check anything.`,
        nextStep: 'Wait a minute, then run the scan again.',
      };
    case 'unknown':
      return {
        title: 'The target refused the scan',
        detail: `Your app answered HTTP ${blocked.status} instead of a page, so our probe never saw it. A firewall or an auth wall usually sits in front of the URL.`,
        nextStep: allowlistStep,
      };
    default: {
      const exhaustive: never = blocked.source;
      return exhaustive;
    }
  }
}
