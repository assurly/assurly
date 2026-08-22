/** Shared copy for the dashboard re-auth chrome after a dead session. */
export const SESSION_EXPIRED_MESSAGE = 'Your session expired. Sign in again to continue.';

type UnauthorizedSessionListener = () => void;

const listeners = new Set<UnauthorizedSessionListener>();

/**
 * Subscribe to authenticated-API 401s. The dashboard uses this to drop the
 * frozen SSR user and show the sign-in chrome. Listeners must be idempotent.
 */
export function subscribeToUnauthorizedSession(listener: UnauthorizedSessionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Notify every subscriber that the session is no longer usable. */
export function notifyUnauthorizedSession(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Test-only: drop subscribers so cases cannot leak across files. */
export function __resetUnauthorizedSessionForTests(): void {
  listeners.clear();
}
