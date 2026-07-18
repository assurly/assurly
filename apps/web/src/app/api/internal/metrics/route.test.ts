import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getAdminDbAdapter: vi.fn() }));
vi.mock('../../../../utils/dbAdapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/dbAdapter')>()),
  getAdminDbAdapter: mocks.getAdminDbAdapter,
}));

import { GET } from './route';
import { resetRateLimitsForTests } from '../../../../utils/rateLimit';
import type { FixOutcomeCorpusRow } from '../../../../utils/dbAdapter';

const SECRET = 'metrics-secret-value';

const corpus: FixOutcomeCorpusRow[] = [
  {
    generator_fingerprint: 'lovable',
    finding_rule_id: 'runtime-supabase-rls-open',
    fix_strategy: 'enable-rls',
    outcome: 'verified_fixed',
  },
  {
    generator_fingerprint: 'lovable',
    finding_rule_id: 'runtime-supabase-rls-open',
    fix_strategy: 'enable-rls',
    outcome: 'regressed',
  },
  {
    generator_fingerprint: 'v0',
    finding_rule_id: 'runtime-missing-security-headers',
    fix_strategy: null,
    outcome: 'still_open',
  },
];

function request(authorization: string | null): Request {
  return new Request('http://localhost/api/internal/metrics', {
    headers: authorization ? { authorization } : {},
  });
}

describe('GET /api/internal/metrics', () => {
  const getFixOutcomeCorpus = vi.fn();
  const countMonitoredApps = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    process.env.METRICS_SECRET = SECRET;
    getFixOutcomeCorpus.mockResolvedValue(corpus);
    countMonitoredApps.mockResolvedValue(42);
    mocks.getAdminDbAdapter.mockReturnValue({ getFixOutcomeCorpus, countMonitoredApps });
  });

  it('rejects a missing secret with 401 and does no DB work', async () => {
    const response = await GET(request(null));
    expect(response.status).toBe(401);
    expect(mocks.getAdminDbAdapter).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret with 401 and does no DB work', async () => {
    const response = await GET(request('Bearer wrong'));
    expect(response.status).toBe(401);
    expect(mocks.getAdminDbAdapter).not.toHaveBeenCalled();
  });

  it('rejects when METRICS_SECRET is unset (fail-closed)', async () => {
    delete process.env.METRICS_SECRET;
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(401);
    expect(mocks.getAdminDbAdapter).not.toHaveBeenCalled();
  });

  it('returns aggregate KPIs for a valid secret', async () => {
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.appsMonitored).toBe(42);
    expect(body.corpusSize).toBe(3);
    expect(body.fixesVerified).toBe(1);
    expect(body.regressionsCaught).toBe(1);
    expect(body.verifiedFixRate).toBe(0.5);
  });

  it('reads ONLY the pattern-only corpus + a scalar count (no per-customer query)', async () => {
    await GET(request(`Bearer ${SECRET}`));
    const adapter = mocks.getAdminDbAdapter.mock.results[0]?.value as Record<string, unknown>;
    // The route touches only the aggregate surfaces — no getTargets/getOrganization/etc.
    expect(Object.keys(adapter).sort()).toEqual(['countMonitoredApps', 'getFixOutcomeCorpus']);
    expect(getFixOutcomeCorpus).toHaveBeenCalledOnce();
  });

  it('never leaks a finding message, table name, PII, or per-customer field', async () => {
    const response = await GET(request(`Bearer ${SECRET}`));
    const serialized = JSON.stringify(await response.json());
    for (const forbidden of [
      'enable-rls',
      'fix_strategy',
      'message',
      'organization',
      'target_id',
      'pr_url',
      'deploy_id',
      '@',
      'customers',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
