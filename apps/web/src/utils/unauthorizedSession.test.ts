import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetUnauthorizedSessionForTests,
  notifyUnauthorizedSession,
  subscribeToUnauthorizedSession,
} from './unauthorizedSession';

describe('unauthorizedSession', () => {
  afterEach(() => {
    __resetUnauthorizedSessionForTests();
  });

  it('notifies every subscriber', () => {
    const first = vi.fn();
    const second = vi.fn();
    subscribeToUnauthorizedSession(first);
    subscribeToUnauthorizedSession(second);

    notifyUnauthorizedSession();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not notify after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToUnauthorizedSession(listener);

    unsubscribe();
    notifyUnauthorizedSession();

    expect(listener).not.toHaveBeenCalled();
  });

  it('is safe to notify twice (listeners must be idempotent)', () => {
    const listener = vi.fn();
    subscribeToUnauthorizedSession(listener);

    notifyUnauthorizedSession();
    notifyUnauthorizedSession();

    expect(listener).toHaveBeenCalledTimes(2);
  });
});
