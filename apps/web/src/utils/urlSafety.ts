import { isIP } from 'node:net';

export class UrlSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlSafetyError';
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
]);

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return octets;
}

function isPrivateOrBlockedIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return false;

  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true; // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved and broadcast
  return false;
}

/** The eight 16-bit groups of an IPv6 address (zone id dropped), or null if it is not one. */
function ipv6Groups(address: string): number[] | null {
  const withoutZone = address.split('%')[0] ?? '';
  if (isIP(withoutZone) !== 6) return null;

  // A trailing dotted IPv4 (::ffff:127.0.0.1) becomes its two hex groups.
  const dotted = withoutZone.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const octets = dotted ? parseIpv4(dotted) : null;
  if (dotted && !octets) return null;
  const hex =
    dotted && octets
      ? `${withoutZone.slice(0, -dotted.length)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`
      : withoutZone;

  const [head = '', tail] = hex.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const parts =
    tail === undefined
      ? headParts
      : [
          ...headParts,
          ...Array<string>(8 - headParts.length - tailParts.length).fill('0'),
          ...tailParts,
        ];
  return parts.length === 8 ? parts.map((part) => parseInt(part, 16)) : null;
}

function ipv4FromGroups(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/**
 * An IPv6 address can carry an IPv4 one, and a dual-stack socket connects to
 * the IPv4 address inside — so ::ffff:169.254.169.254 is judged as
 * 169.254.169.254. Unparseable input fails closed.
 */
function isPrivateOrBlockedIpv6(address: string): boolean {
  const g = ipv6Groups(address);
  if (!g) return true;
  const zeros = (from: number, to: number): boolean => g.slice(from, to).every((x) => x === 0);

  // ::ffff:0:0/96 — IPv4-mapped.
  if (zeros(0, 5) && g[5] === 0xffff) return isPrivateOrBlockedIpv4(ipv4FromGroups(g[6], g[7]));
  // ::/96 — unspecified (::), loopback (::1) and the deprecated IPv4-compatible form.
  if (zeros(0, 6)) return true;
  // 64:ff9b::/96 — NAT64 well-known prefix; 64:ff9b:1::/48 is local-use NAT64.
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    return zeros(2, 6) ? isPrivateOrBlockedIpv4(ipv4FromGroups(g[6], g[7])) : g[2] === 1;
  }
  // 2002::/16 — 6to4 carries an IPv4 address in the next 32 bits.
  if (g[0] === 0x2002) return isPrivateOrBlockedIpv4(ipv4FromGroups(g[1], g[2]));
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

export function isPrivateOrBlockedHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/\.$/, '');
  if (!normalized) return true;
  if (BLOCKED_HOSTNAMES.has(normalized)) return true;
  if (normalized.endsWith('.localhost')) return true;

  const withoutBrackets = normalized.startsWith('[') ? normalized.slice(1, -1) : normalized;
  const ipVersion = isIP(withoutBrackets);
  if (ipVersion === 4) return isPrivateOrBlockedIpv4(withoutBrackets);
  if (ipVersion === 6) return isPrivateOrBlockedIpv6(withoutBrackets);
  return false;
}

export function assertPublicIpAddress(address: string): void {
  if (isPrivateOrBlockedHost(address)) {
    throw new UrlSafetyError('Target host resolves to a private or blocked network address.');
  }
}

export function assertScannableUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new UrlSafetyError('URL is required.');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new UrlSafetyError('URL is malformed.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlSafetyError('Only http and https URLs are allowed.');
  }

  if (!url.hostname) {
    throw new UrlSafetyError('URL hostname is missing.');
  }

  if (url.username || url.password) {
    throw new UrlSafetyError('URL credentials are not allowed.');
  }

  if (isPrivateOrBlockedHost(url.hostname)) {
    throw new UrlSafetyError('Target host is not allowed.');
  }

  return url;
}
