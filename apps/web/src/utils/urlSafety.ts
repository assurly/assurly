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
  return false;
}

function isPrivateOrBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe80')) return true;
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
