import { describe, expect, it, vi } from 'vitest';
import type { ScannerFinding } from '@assurly/scanner-core';
import type { DbAdapter, LiveLockAttemptRow, Target } from './dbAdapter';
import { probeDeployment, runLiveLock, withDeploymentBypass } from './liveLock';
import type { LookupImpl } from './runtimeScanner';

function target(overrides: Partial<Target> = {}): Target {
  return {
    id: 'target-1',
    organization_id: 'org-1',
    kind: 'url',
    identifier: 'https://app.example.com',
    display_name: 'Example',
    repository_id: null,
    generator_fingerprint: null,
    ownership_verified: true,
    ownership_method: 'dns_txt',
    current_verdict: 'blocked',
    current_ship_score: 59,
    verdict_evidence: null,
    last_checked_at: null,
    badge_token: 'a'.repeat(32),
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function row(overrides: Partial<LiveLockAttemptRow> = {}): LiveLockAttemptRow {
  return {
    id: 'attempt-1',
    organization_id: 'org-1',
    target_id: 'target-1',
    git_sha: 'abc1234',
    attempt_id: 'run-1',
    status: 'blocked',
    ship_score: 59,
    reason: 'runtime_blocker',
    created_at: '2026-10-23T12:00:00.000Z',
    ...overrides,
  };
}

function finding(ruleId: string): ScannerFinding {
  return {
    ruleId,
    severity: 'error',
    confidence: 'high',
    message: 'Rows are readable.',
    file: 'runtime',
    suggestion: 'Close the table.',
  };
}

function adapter(existing: LiveLockAttemptRow | null = null): DbAdapter {
  const inserted: LiveLockAttemptRow[] = [];
  return {
    getLiveLockAttempt: vi.fn(async () => existing),
    insertLiveLockAttempt: vi.fn(async (input) => {
      const stored = row({
        git_sha: input.gitSha,
        attempt_id: input.attemptId,
        status: input.status,
        ship_score: input.shipScore,
        reason: input.reason,
      });
      inserted.push(stored);
      return stored;
    }),
    upsertTarget: vi.fn(async () => target()),
    getFixOutcomesForTarget: vi.fn(async () => []),
    insertFixOutcomes: vi.fn(async () => undefined),
    replaceProbeEvidenceForTarget: undefined,
  } as unknown as DbAdapter;
}

describe('runLiveLock', () => {
  it('returns the stored attempt and does not probe again', async () => {
    const db = adapter(row({ status: 'ready', reason: 'clear', ship_score: 100 }));
    const scanImpl = vi.fn();
    const result = await runLiveLock({
      target: target(),
      gitSha: 'ABC1234',
      attemptId: 'run-1',
      db,
      scanImpl: scanImpl as never,
    });
    expect(result.status).toBe('ready');
    expect(result.fresh).toBe(false);
    expect(scanImpl).not.toHaveBeenCalled();
    expect(db.insertLiveLockAttempt).not.toHaveBeenCalled();
  });

  it('blocks an unverified URL without calling the scanner', async () => {
    const db = adapter();
    const scanImpl = vi.fn();
    const result = await runLiveLock({
      target: target({ ownership_verified: false }),
      gitSha: 'abc1234',
      attemptId: 'run-2',
      db,
      scanImpl: scanImpl as never,
    });
    expect(result).toMatchObject({
      status: 'blocked',
      shipScore: 0,
      reason: 'ownership_unverified',
      fresh: true,
    });
    expect(scanImpl).not.toHaveBeenCalled();
  });

  it('caps the score at 59 when the fresh probe still has a blocker', async () => {
    const db = adapter();
    const scanImpl = vi.fn(async () => ({
      findings: [finding('runtime-supabase-rls-open')],
      evidence: [],
      blocked: undefined,
    }));
    const result = await runLiveLock({
      target: target(),
      gitSha: 'abc1234',
      attemptId: 'run-3',
      db,
      scanImpl: scanImpl as never,
    });
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('runtime_blocker');
    expect(result.shipScore).toBeLessThanOrEqual(59);
  });

  it('is ready only when the fresh probe has no blocker', async () => {
    const db = adapter();
    const scanImpl = vi.fn(async () => ({
      findings: [],
      evidence: [],
      blocked: undefined,
    }));
    const result = await runLiveLock({
      target: target(),
      gitSha: 'abc1234',
      attemptId: 'run-4',
      db,
      scanImpl: scanImpl as never,
    });
    expect(result).toMatchObject({ status: 'ready', reason: 'clear', shipScore: 100 });
  });
});

describe('probeDeployment', () => {
  const DEPLOYMENT = 'https://app-abc123-team.vercel.app';
  const PUBLIC_DNS: LookupImpl = async () => [{ address: '76.76.21.21', family: 4 }];

  function page(status: number, headers: Record<string, string> = {}): typeof fetch {
    return vi.fn(async () => new Response('<html></html>', { status, headers })) as never;
  }

  it('does not fetch a deployment of an unverified URL', async () => {
    const fetchImpl = page(200);
    const result = await probeDeployment({
      target: target({ ownership_verified: false }),
      deploymentUrl: DEPLOYMENT,
      fetchImpl,
      lookupImpl: PUBLIC_DNS,
    });
    expect(result.outcome).toBe('ownership_unverified');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a URL Vercel did not generate', async () => {
    const fetchImpl = page(200);
    const result = await probeDeployment({
      target: target(),
      deploymentUrl: 'https://app.example.com',
      fetchImpl,
      lookupImpl: PUBLIC_DNS,
    });
    expect(result.outcome).toBe('probe_refused');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports Deployment Protection instead of grading the login page', async () => {
    const scanImpl = vi.fn();
    const result = await probeDeployment({
      target: target(),
      deploymentUrl: DEPLOYMENT,
      fetchImpl: page(401),
      lookupImpl: PUBLIC_DNS,
      scanImpl: scanImpl as never,
    });
    expect(result.outcome).toBe('deployment_protected');
    expect(scanImpl).not.toHaveBeenCalled();
  });

  it('does not follow a redirect to the Vercel login', async () => {
    const scanImpl = vi.fn();
    const result = await probeDeployment({
      target: target(),
      deploymentUrl: DEPLOYMENT,
      fetchImpl: page(307, { location: 'https://vercel.com/sso-api?url=x' }),
      lookupImpl: PUBLIC_DNS,
      scanImpl: scanImpl as never,
    });
    expect(result.outcome).toBe('deployment_protected');
    expect(scanImpl).not.toHaveBeenCalled();
  });

  it('is clear when the deployment has no proven blocker', async () => {
    const scanImpl = vi.fn(async () => ({ findings: [], evidence: [], blocked: undefined }));
    const result = await probeDeployment({
      target: target(),
      deploymentUrl: DEPLOYMENT,
      fetchImpl: page(200),
      lookupImpl: PUBLIC_DNS,
      scanImpl: scanImpl as never,
    });
    expect(result).toEqual({ outcome: 'clear', shipScore: 100, blockers: [] });
    expect(scanImpl).toHaveBeenCalledWith(
      DEPLOYMENT,
      expect.any(Function),
      PUBLIC_DNS,
      expect.objectContaining({ activeProbe: true, useAiPlanner: false }),
    );
  });

  it('names the blockers the deployment would ship', async () => {
    const scanImpl = vi.fn(async () => ({
      findings: [finding('runtime-supabase-rls')],
      evidence: [],
      blocked: undefined,
    }));
    const result = await probeDeployment({
      target: target(),
      deploymentUrl: DEPLOYMENT,
      fetchImpl: page(200),
      lookupImpl: PUBLIC_DNS,
      scanImpl: scanImpl as never,
    });
    expect(result.outcome).toBe('runtime_blocker');
    expect(result.shipScore).toBeLessThanOrEqual(59);
    expect(result.blockers).toEqual([
      { ruleId: 'runtime-supabase-rls', message: 'Rows are readable.', location: 'runtime' },
    ]);
  });

  it('is unavailable, never clear, when the probe runs out of time', async () => {
    const scanImpl = vi.fn(() => new Promise(() => undefined));
    const result = await probeDeployment({
      target: target(),
      deploymentUrl: DEPLOYMENT,
      fetchImpl: page(200),
      lookupImpl: PUBLIC_DNS,
      scanImpl: scanImpl as never,
      budgetMs: 20,
    });
    expect(result.outcome).toBe('probe_unavailable');
  });
});

describe('withDeploymentBypass', () => {
  const SECRET = 'a'.repeat(32);
  const ORIGIN = 'https://app-abc123-team.vercel.app';

  function sentHeaders(fetchImpl: ReturnType<typeof vi.fn>, call: number): Headers {
    const init = fetchImpl.mock.calls[call]?.[1] as RequestInit | undefined;
    return new Headers(init?.headers);
  }

  it('sends the bypass only to the deployment origin', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok'));
    const wrapped = withDeploymentBypass(fetchImpl as never, ORIGIN, SECRET);

    await wrapped(`${ORIGIN}/api/admin/customers`, { headers: { accept: 'text/html' } });
    await wrapped('https://xyz.supabase.co/rest/v1/customers', { headers: { apikey: 'anon' } });
    await wrapped('https://app-abc123-team.vercel.app.evil.com/', {});

    expect(sentHeaders(fetchImpl, 0).get('x-vercel-protection-bypass')).toBe(SECRET);
    expect(sentHeaders(fetchImpl, 0).get('accept')).toBe('text/html');
    expect(sentHeaders(fetchImpl, 1).get('x-vercel-protection-bypass')).toBeNull();
    expect(sentHeaders(fetchImpl, 1).get('apikey')).toBe('anon');
    expect(sentHeaders(fetchImpl, 2).get('x-vercel-protection-bypass')).toBeNull();
  });

  it('lets probeDeployment through protection with the secret', async () => {
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) =>
      new Headers(init?.headers).get('x-vercel-protection-bypass') === SECRET
        ? new Response('<html></html>', { status: 200 })
        : new Response('', { status: 302, headers: { location: 'https://vercel.com/sso-api' } }),
    );
    const scanImpl = vi.fn(async () => ({ findings: [], evidence: [], blocked: undefined }));
    const PUBLIC_DNS: LookupImpl = async () => [{ address: '76.76.21.21', family: 4 }];

    const without = await probeDeployment({
      target: target(),
      deploymentUrl: ORIGIN,
      fetchImpl: fetchImpl as never,
      lookupImpl: PUBLIC_DNS,
      scanImpl: scanImpl as never,
    });
    expect(without.outcome).toBe('deployment_protected');

    const withSecret = await probeDeployment({
      target: target(),
      deploymentUrl: ORIGIN,
      fetchImpl: fetchImpl as never,
      lookupImpl: PUBLIC_DNS,
      scanImpl: scanImpl as never,
      bypassSecret: SECRET,
    });
    expect(withSecret.outcome).toBe('clear');
  });
});
