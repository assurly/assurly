import { resolveTxt } from 'node:dns/promises';
import { readLimitedResponseText } from '../githubApp';
import { safeFetch, type LookupImpl } from '../runtimeScanner';
import { OWNERSHIP_FILE_PATH, OWNERSHIP_META_NAME, OWNERSHIP_TXT_PREFIX } from './token';

/**
 * The ownership-challenge methods implemented in Phase 3. `github_app` (implicit
 * for connected repos) and `deploy_link` (OAuth, later) are handled elsewhere /
 * deferred, so they are intentionally not part of this active-challenge union.
 */
export type OwnershipChallengeMethod = 'meta_tag' | 'dns_txt' | 'file';

/** Resolves the TXT records for a hostname. Injectable so tests never hit DNS. */
export type ResolveTxtImpl = (hostname: string) => Promise<string[][]>;

export interface OwnershipVerificationDeps {
  fetchImpl?: typeof fetch;
  lookupImpl?: LookupImpl;
  resolveTxtImpl?: ResolveTxtImpl;
}

/** Cap on the HTML / file body we read while verifying (1 MiB is plenty). */
const OWNERSHIP_MAX_RESPONSE_BYTES = 1024 * 1024;

const defaultResolveTxt: ResolveTxtImpl = (hostname) => resolveTxt(hostname);

/** True when the HTML contains `<meta name="assurly-verify" content="<token>">`. */
function htmlHasMetaToken(html: string, token: string): boolean {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const name = tag.match(/\bname=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = tag.match(/\bcontent=["']([^"']+)["']/i)?.[1];
    if (name === OWNERSHIP_META_NAME && content?.trim() === token) return true;
  }
  return false;
}

/**
 * Fetches the target site (SSRF-safe, GET-only, redirects re-validated) and
 * checks for the ownership meta tag. Never touches a private host and never
 * issues a mutating request.
 */
async function verifyMetaTag(
  identifier: string,
  token: string,
  deps: OwnershipVerificationDeps,
): Promise<boolean> {
  const { response } = await safeFetch(
    identifier,
    { method: 'GET' },
    deps.fetchImpl,
    deps.lookupImpl,
  );
  if (!response.ok) return false;
  const html = await readLimitedResponseText(response, OWNERSHIP_MAX_RESPONSE_BYTES);
  return htmlHasMetaToken(html, token);
}

/** Looks up the site's TXT records (DNS only, no HTTP) for `assurly-verify=<token>`. */
async function verifyDnsTxt(
  identifier: string,
  token: string,
  deps: OwnershipVerificationDeps,
): Promise<boolean> {
  const hostname = new URL(identifier).hostname;
  const resolve = deps.resolveTxtImpl ?? defaultResolveTxt;
  let records: string[][];
  try {
    records = await resolve(hostname);
  } catch {
    return false;
  }
  const expected = `${OWNERSHIP_TXT_PREFIX}${token}`;
  return records.some((chunks) => chunks.join('').trim() === expected);
}

/**
 * Fetches `/.well-known/assurly-verify.txt` (SSRF-safe, GET-only) and checks the
 * body for the token.
 */
async function verifyFile(
  identifier: string,
  token: string,
  deps: OwnershipVerificationDeps,
): Promise<boolean> {
  const fileUrl = new URL(OWNERSHIP_FILE_PATH, identifier).toString();
  const { response } = await safeFetch(fileUrl, { method: 'GET' }, deps.fetchImpl, deps.lookupImpl);
  if (!response.ok) return false;
  const body = (await readLimitedResponseText(response, OWNERSHIP_MAX_RESPONSE_BYTES)).trim();
  return body === token || body.split(/\s+/).includes(token);
}

/**
 * Runs the requested ownership challenge and returns whether it passed. All HTTP
 * paths go through `safeFetch` (SSRF-safe, GET-only); the DNS path performs no
 * HTTP at all. Callers must only persist `ownership_verified = true` when this
 * resolves `true`.
 */
export async function verifyOwnership(
  method: OwnershipChallengeMethod,
  identifier: string,
  token: string,
  deps: OwnershipVerificationDeps = {},
): Promise<boolean> {
  switch (method) {
    case 'meta_tag':
      return verifyMetaTag(identifier, token, deps);
    case 'dns_txt':
      return verifyDnsTxt(identifier, token, deps);
    case 'file':
      return verifyFile(identifier, token, deps);
    default: {
      const exhaustive: never = method;
      return exhaustive;
    }
  }
}
