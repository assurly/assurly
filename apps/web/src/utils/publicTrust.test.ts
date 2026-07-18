import { describe, expect, it } from 'vitest';
import type { Target } from './dbAdapter';
import { PUBLIC_TRUST_KEYS, toPublicTrustProjection } from './publicTrust';

function target(overrides: Partial<Target> = {}): Target {
  return {
    id: 'target-1',
    organization_id: 'org-secret',
    kind: 'url',
    identifier: 'https://app.example',
    display_name: 'Demo App',
    repository_id: null,
    generator_fingerprint: 'lovable',
    ownership_verified: true,
    ownership_method: 'meta_tag',
    current_verdict: 'blocked',
    current_ship_score: 72,
    verdict_evidence: {
      topIssue: {
        key: 'runtime-supabase-rls-open',
        label: 'Open RLS',
        severity: 'error',
        sampleMessage: 'Table users is readable via anon key',
        affectedFileCount: 1,
        occurrenceCount: 1,
      },
      blockerSnapshot: [
        {
          rule_id: 'runtime-supabase-rls-open',
          file_path: 'runtime',
          message: 'secret row data must never leak',
          severity: 'error',
        },
      ],
      previousShipScore: 96,
    },
    last_checked_at: '2026-07-18T08:00:00.000Z',
    badge_token: 'b'.repeat(32),
    created_at: '2026-07-16T00:00:00Z',
    updated_at: '2026-07-16T00:00:00Z',
    ...overrides,
  };
}

describe('toPublicTrustProjection', () => {
  it('exposes only whitelisted public fields (no evidence rows, no org id)', () => {
    const projection = toPublicTrustProjection(target());
    expect(projection).not.toBeNull();
    expect(Object.keys(projection!).sort()).toEqual([...PUBLIC_TRUST_KEYS].sort());
    expect(projection).toMatchObject({
      displayName: 'Demo App',
      identifier: 'https://app.example',
      verdict: 'blocked',
      shipScore: 72,
      badgeToken: 'b'.repeat(32),
      topIssue: {
        label: 'Open RLS',
        sampleMessage: 'Table users is readable via anon key',
      },
    });

    const json = JSON.stringify(projection);
    expect(json).not.toContain('org-secret');
    expect(json).not.toContain('blockerSnapshot');
    expect(json).not.toContain('secret row data');
    expect(json).not.toContain('organization');
    expect(json).not.toContain('webhook');
  });

  it('returns null when the target has no badge token', () => {
    expect(toPublicTrustProjection(target({ badge_token: null }))).toBeNull();
  });
});
