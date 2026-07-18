import { afterEach, describe, expect, it } from 'vitest';
import { verifyCronAuthorization } from './cronAuth';

describe('verifyCronAuthorization', () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('rejects when CRON_SECRET is unset', () => {
    delete process.env.CRON_SECRET;
    expect(verifyCronAuthorization('Bearer anything')).toBe(false);
  });

  it('rejects a missing Authorization header', () => {
    process.env.CRON_SECRET = 'test-secret';
    expect(verifyCronAuthorization(null)).toBe(false);
  });

  it('rejects an invalid bearer token', () => {
    process.env.CRON_SECRET = 'test-secret';
    expect(verifyCronAuthorization('Bearer wrong')).toBe(false);
  });

  it('accepts the exact Bearer secret', () => {
    process.env.CRON_SECRET = 'test-secret';
    expect(verifyCronAuthorization('Bearer test-secret')).toBe(true);
  });
});
