import { describe, expect, it } from 'vitest';
import { formatApiKeyDay, formatApiKeyMetadata } from './apiKeyDisplay';

describe('formatApiKeyDay', () => {
  it('formats a UTC ISO timestamp as a fixed English day + month', () => {
    expect(formatApiKeyDay('2026-07-18T15:30:00.000Z')).toBe('18 Jul');
    expect(formatApiKeyDay('2026-01-01T00:00:00.000Z')).toBe('1 Jan');
    expect(formatApiKeyDay('2026-12-31T23:59:59.000Z')).toBe('31 Dec');
  });

  it('returns the raw string when the timestamp is invalid', () => {
    expect(formatApiKeyDay('not-a-date')).toBe('not-a-date');
  });
});

describe('formatApiKeyMetadata', () => {
  const now = new Date('2026-07-20T12:00:00.000Z');

  it('shows created + never used when lastUsedAt is null', () => {
    expect(
      formatApiKeyMetadata(
        {
          createdAt: '2026-07-18T00:00:00.000Z',
          lastUsedAt: null,
          revokedAt: null,
        },
        now,
      ),
    ).toBe('Created 18 Jul · Never used');
  });

  it('shows a relative last-used phrase for recent activity', () => {
    expect(
      formatApiKeyMetadata(
        {
          createdAt: '2026-07-18T00:00:00.000Z',
          lastUsedAt: '2026-07-18T12:00:00.000Z',
          revokedAt: null,
        },
        now,
      ),
    ).toBe('Created 18 Jul · Last used 2 days ago');
  });

  it('shows revoked day instead of last-used for revoked keys', () => {
    expect(
      formatApiKeyMetadata(
        {
          createdAt: '2026-07-10T00:00:00.000Z',
          lastUsedAt: '2026-07-12T00:00:00.000Z',
          revokedAt: '2026-07-19T08:00:00.000Z',
        },
        now,
      ),
    ).toBe('Created 10 Jul · Revoked 19 Jul');
  });

  it('is deterministic for the same inputs (no locale formatting)', () => {
    const input = {
      createdAt: '2026-07-18T00:00:00.000Z',
      lastUsedAt: '2026-07-18T12:00:00.000Z',
      revokedAt: null,
    };
    expect(formatApiKeyMetadata(input, now)).toBe(formatApiKeyMetadata(input, now));
  });
});
