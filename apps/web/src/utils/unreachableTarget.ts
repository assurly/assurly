/** Thrown by the runtime scanner when a lookup returns no addresses at all. */
export const UNRESOLVED_HOST_MESSAGE = 'Target host could not be resolved.';

/**
 * Vercel's resolver reports a domain that does not exist as EBUSY, not
 * ENOTFOUND, so every failed DNS lookup counts.
 */
function isUnresolvedHostError(error: Error): boolean {
  const { code, syscall } = error as Error & { code?: unknown; syscall?: unknown };
  return (
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    syscall === 'getaddrinfo' ||
    error.message === UNRESOLVED_HOST_MESSAGE
  );
}

/**
 * Why the page itself could not be loaded, or null when the error is not a
 * network failure (and so is ours to report as an internal error).
 */
export function unreachableReason(error: unknown, host: string): string | null {
  if (!(error instanceof Error)) return null;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return `${host} did not answer within 8 seconds.`;
  }
  if (isUnresolvedHostError(error)) {
    return `The domain ${host} does not resolve to a server.`;
  }
  if (error.message.startsWith('Too many redirects')) {
    return `${host} redirects too many times to reach a page.`;
  }
  if (error instanceof TypeError && error.message === 'fetch failed') {
    return `Could not connect to ${host} (connection refused or a TLS certificate problem).`;
  }
  return null;
}
