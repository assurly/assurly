import { describe, expect, it, vi } from 'vitest';
import {
  attachSecretExposureWindows,
  fetchPathExposureWindow,
  messageContainsPlantedSecret,
} from './secretExposureWindow';
import type { WebFinding } from './browserScanner';

const PLANTED_SECRET = 'sk_live_PLANTED_SECRET_VALUE_DO_NOT_LEAK_12345';

function secretFinding(overrides: Partial<WebFinding & { path?: string }> = {}): WebFinding & {
  path?: string;
} {
  return {
    ruleId: 'stripe-secret-leak',
    severity: 'error',
    confidence: 'high',
    file: '.env.example',
    path: '.env.example',
    line: 3,
    message: 'CRITICAL KEY LEAK: Hardcoded Stripe secret key found (sk_live...).',
    suggestion: 'Rotate the key.',
    ...overrides,
  };
}

describe('fetchPathExposureWindow', () => {
  it('computes days and commit count from history (newest-first)', async () => {
    const now = Date.parse('2026-07-26T00:00:00.000Z');
    const fetchImpl = vi.fn(async () =>
      Response.json([
        {
          sha: 'aaa',
          commit: { author: { date: '2026-07-25T00:00:00.000Z' } },
        },
        {
          sha: 'bbb',
          commit: { author: { date: '2026-07-20T00:00:00.000Z' } },
        },
        {
          sha: 'ccc',
          commit: { author: { date: '2026-07-20T00:00:00.000Z' } },
        },
      ]),
    );
    const window = await fetchPathExposureWindow('tok', 'owner/repo', '.env.example', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });
    expect(window?.daysExposed).toBe(6);
    expect(window?.commitCount).toBe(3);
    expect(window?.summary).toContain('6 days');
    expect(window?.summary).toContain('3 commits');
  });

  it('returns null when history is unavailable', async () => {
    const fetchImpl = vi.fn(async () => new Response('oops', { status: 500 }));
    const window = await fetchPathExposureWindow('tok', 'owner/repo', '.env.example', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(window).toBeNull();
  });
});

describe('attachSecretExposureWindows', () => {
  it('appends a public exposure window on public repos', async () => {
    const findings = [secretFinding()];
    const fetchImpl = vi.fn(async () =>
      Response.json([
        { sha: 'a', commit: { author: { date: '2026-07-20T00:00:00.000Z' } } },
        { sha: 'b', commit: { author: { date: '2026-07-14T00:00:00.000Z' } } },
      ]),
    );
    await attachSecretExposureWindows(findings, {
      token: 'tok',
      repositoryName: 'owner/public',
      isPrivate: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => Date.parse('2026-07-20T00:00:00.000Z'),
    });
    expect(findings[0]!.message).toMatch(/been in the repository for/);
    expect(findings[0]!.severity).toBe('error');
  });

  it('does not compute a span for private repos', async () => {
    const findings = [secretFinding()];
    const fetchImpl = vi.fn();
    await attachSecretExposureWindows(findings, {
      token: 'tok',
      repositoryName: 'owner/private',
      isPrivate: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(findings[0]!.message).toContain('not publicly exposed');
    expect(findings[0]!.message).not.toMatch(/\d+ days/);
  });

  it('omits the span when history is missing', async () => {
    const findings = [secretFinding()];
    const fetchImpl = vi.fn(async () => new Response('[]', { status: 200 }));
    await attachSecretExposureWindows(findings, {
      token: 'tok',
      repositoryName: 'owner/public',
      isPrivate: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(findings[0]!.message).not.toMatch(/been in the repository/);
  });

  it('never includes a planted secret value in the output', async () => {
    const findings = [
      secretFinding({
        message: `CRITICAL KEY LEAK: Hardcoded Stripe secret key found (sk_live...).`,
      }),
    ];
    const fetchImpl = vi.fn(async () =>
      Response.json([{ sha: 'a', commit: { author: { date: '2026-07-01T00:00:00.000Z' } } }]),
    );
    await attachSecretExposureWindows(findings, {
      token: 'tok',
      repositoryName: 'owner/public',
      isPrivate: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => Date.parse('2026-07-10T00:00:00.000Z'),
    });
    expect(messageContainsPlantedSecret(findings[0]!.message, PLANTED_SECRET)).toBe(false);
    expect(findings[0]!.message).not.toContain(PLANTED_SECRET);
    expect(JSON.stringify(findings)).not.toContain(PLANTED_SECRET);
  });
});
