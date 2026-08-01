/**
 * Splits a target display name into a distinctive primary label and optional
 * secondary context so dense "Your apps" grids stay readable.
 *
 * Repos (`owner/repo`) lead with the repo name; URLs lead with the hostname.
 * Truncating the raw full string mid-grid made cards look like "v...", "acme/…".
 */

export type VerdictCardKind = 'repo' | 'url';

export interface VerdictCardLabel {
  /** Distinctive short name shown large (repo name or hostname). */
  primary: string;
  /** Supporting context (owner or URL path), shown muted under the primary. */
  secondary: string | null;
  /** Full original string — use for title / aria. */
  full: string;
}

function isLikelyUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^[a-z0-9.-]+\.[a-z]{2,}([/:?]|$)/i.test(value);
}

function splitOwnerRepo(value: string): { owner: string; repo: string } | null {
  if (value.includes('://') || value.startsWith('http')) return null;
  const slash = value.indexOf('/');
  if (slash <= 0) return null;
  const owner = value.slice(0, slash).trim();
  const repo = value.slice(slash + 1).trim();
  if (!owner || !repo || repo.includes('/')) return null;
  return { owner, repo };
}

function splitUrl(value: string): { host: string; path: string | null } | null {
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    const host = url.hostname.replace(/^www\./i, '');
    if (!host) return null;
    const pathWithQuery = `${url.pathname}${url.search}${url.hash}`;
    const path =
      pathWithQuery === '/' || pathWithQuery === '' ? null : pathWithQuery.replace(/\/$/, '');
    return { host, path };
  } catch {
    return null;
  }
}

export function formatVerdictCardLabel(
  displayName: string,
  kind: VerdictCardKind,
): VerdictCardLabel {
  const full = displayName.trim();
  if (!full) {
    return { primary: 'Untitled app', secondary: null, full: displayName };
  }

  if (kind === 'repo') {
    const parts = splitOwnerRepo(full);
    if (parts) {
      return { primary: parts.repo, secondary: parts.owner, full };
    }
  }

  if (kind === 'url' || isLikelyUrl(full)) {
    const parts = splitUrl(full);
    if (parts) {
      return { primary: parts.host, secondary: parts.path, full };
    }
  }

  // Fallback: still try owner/repo shape when kind is ambiguous.
  const parts = splitOwnerRepo(full);
  if (parts) {
    return { primary: parts.repo, secondary: parts.owner, full };
  }

  return { primary: full, secondary: null, full };
}
