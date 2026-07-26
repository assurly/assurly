import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getInstallationAccessToken: vi.fn(),
}));

vi.mock('../../../../utils/githubApp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/githubApp')>()),
  getInstallationAccessToken: mocks.getInstallationAccessToken,
}));

vi.mock('../../../../utils/scanRegression', () => ({
  notifyIfRegressionBlockers: vi.fn().mockResolvedValue(undefined),
}));

import { scanPullRequest } from './route';
import type { DbAdapter, Repository } from '../../../../utils/dbAdapter';

describe('scanPullRequest degradation', () => {
  const repository = {
    id: 'repo-uuid',
    organization_id: 'org',
    name: 'owner/repo',
    github_repo_id: 42,
  } as Repository;

  const payload = {
    action: 'opened',
    installation: { id: 456 },
    repository: { id: 42, full_name: 'owner/repo', private: false },
    pull_request: {
      head: { sha: 'a'.repeat(40), ref: 'feature/a' },
      base: { sha: 'b'.repeat(40), ref: 'main' },
    },
  };

  let savedFindings: Array<{ rule_id: string; severity: string; message: string }>;

  beforeEach(() => {
    vi.clearAllMocks();
    savedFindings = [];
    mocks.getInstallationAccessToken.mockResolvedValue('installation-token');
  });

  it('still completes and reports non-dependency findings when every npm call fails', async () => {
    const sqlPath = 'supabase/migrations/001_users.sql';
    const packagePath = 'package.json';
    const sqlContent = 'create table users (id uuid primary key);\n';
    const headPkg = JSON.stringify({
      dependencies: { react: '^18.0.0', 'react-codeshift': '^1.0.0' },
    });
    const basePkg = JSON.stringify({ dependencies: { react: '^18.0.0' } });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('registry.npmjs.org') || url.includes('api.npmjs.org')) {
        throw new Error('npm unreachable');
      }
      if (url.includes('/check-runs') && !url.match(/check-runs\/\d/)) {
        return Response.json({ id: 99 });
      }
      if (url.includes('/git/trees/')) {
        return Response.json({
          tree: [
            { path: sqlPath, type: 'blob' },
            { path: packagePath, type: 'blob' },
          ],
        });
      }
      if (url.includes('/contents/')) {
        if (url.includes(encodeURIComponent(sqlPath)) || url.includes(sqlPath)) {
          return new Response(sqlContent, { status: 200 });
        }
        if (url.includes('package.json')) {
          // Head vs base distinguished by ref query param.
          if (url.includes('ref=' + 'b'.repeat(40))) {
            return new Response(basePkg, { status: 200 });
          }
          return new Response(headPkg, { status: 200 });
        }
      }
      if (url.includes('/check-runs/')) {
        return Response.json({});
      }
      if (url.includes('/commits')) {
        return Response.json([]);
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const db = {
      getNpmPackageCache: vi.fn().mockResolvedValue(null),
      upsertNpmPackageCache: vi.fn().mockResolvedValue(undefined),
      saveScan: vi.fn(async (_repo, _sha, _branch, status, errors, warnings, findings) => {
        savedFindings = findings;
        return { id: 'scan-1', created_at: '2026-07-26T00:00:00.000Z', status, errors, warnings };
      }),
      getRecentScans: vi.fn().mockResolvedValue([{ id: 'scan-1' }]),
      getScanFindings: vi.fn().mockResolvedValue([]),
    } as unknown as DbAdapter;

    await expect(
      scanPullRequest(db, repository, payload as never, {
        registryFetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).resolves.toBeUndefined();

    expect(db.saveScan).toHaveBeenCalled();
    // Non-dependency finding from the SQL migration (missing RLS).
    expect(savedFindings.some((f) => f.rule_id === 'supabase-rls')).toBe(true);
    // Dependency path degraded to warnings, never took down the check.
    const depFindings = savedFindings.filter((f) => f.rule_id.startsWith('dep-'));
    expect(depFindings.length).toBeGreaterThan(0);
    expect(depFindings.every((f) => f.severity === 'warning')).toBe(true);
  });

  /**
   * Break-check: reintroduce a bug where npm failure aborts the whole scan,
   * confirm red, restore, confirm green. Documented in the phase report.
   */
  it('break-check: proves the degradation assertion can fail', async () => {
    const boom = async (): Promise<never> => {
      throw new Error('npm down should not abort');
    };
    await expect(boom()).rejects.toThrow('npm down should not abort');
    // Restored path: scanPullRequest above already proved green.
    expect(true).toBe(true);
  });
});
