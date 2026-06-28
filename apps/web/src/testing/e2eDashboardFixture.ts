import type { SessionResult } from '../utils/clientApi';
import type { Scan, ScanFinding } from '../utils/dbAdapter';

export const E2E_ACCESS_TOKEN = 'e2e-dashboard-access-token';

export const e2eAttestaRepo = {
  id: '11000000-0000-4000-8000-000000000010',
  organization_id: 'org-1',
  name: 'tibco87/Attesta',
  github_repo_id: 101,
  is_active: true,
  created_at: '2026-06-21T00:00:00Z',
} as const;

export const e2eLeaksRepo = {
  id: '11000000-0000-4000-8000-000000000011',
  organization_id: 'org-1',
  name: 'react-client-leaks',
  github_repo_id: 102,
  is_active: true,
  created_at: '2026-06-21T00:00:00Z',
} as const;

export const e2eEmptyRepo = {
  id: '11000000-0000-4000-8000-000000000012',
  organization_id: 'org-1',
  name: 'empty-repo',
  github_repo_id: 103,
  is_active: true,
  created_at: '2026-06-21T00:00:00Z',
} as const;

const sharedSha = '669c0392ea81119689959fdbe63b05c3c95ce544';

export const e2eAttestaScans: Scan[] = [
  {
    id: '22000000-0000-4000-8000-000000000003',
    repository_id: e2eAttestaRepo.id,
    commit_sha: sharedSha,
    branch: 'main',
    status: 'failed',
    error_count: 7,
    warning_count: 1,
    created_at: '2026-06-26T08:55:00.000Z',
  },
  {
    id: '22000000-0000-4000-8000-000000000004',
    repository_id: e2eAttestaRepo.id,
    commit_sha: 'deadbeefffffffffffffffffffffffffffffffff',
    branch: 'main',
    status: 'success',
    error_count: 0,
    warning_count: 0,
    created_at: '2026-06-26T09:10:00.000Z',
  },
  {
    id: '22000000-0000-4000-8000-000000000002',
    repository_id: e2eAttestaRepo.id,
    commit_sha: sharedSha,
    branch: 'main',
    status: 'failed',
    error_count: 4,
    warning_count: 1,
    created_at: '2026-06-26T08:30:00.000Z',
  },
  {
    id: '22000000-0000-4000-8000-000000000001',
    repository_id: e2eAttestaRepo.id,
    commit_sha: sharedSha,
    branch: 'main',
    status: 'failed',
    error_count: 3,
    warning_count: 0,
    created_at: '2026-06-26T08:00:00.000Z',
  },
];

export const e2eLeaksScan: Scan = {
  id: '22000000-0000-4000-8000-000000000011',
  repository_id: e2eLeaksRepo.id,
  commit_sha: 'aabbccddeeff00112233445566778899aabbccdd',
  branch: 'main',
  status: 'failed',
  error_count: 2,
  warning_count: 0,
  created_at: '2026-06-26T09:10:00Z',
};

const attestaScanWithFindingsId = '22000000-0000-4000-8000-000000000003';
const attestaCleanScanId = '22000000-0000-4000-8000-000000000004';

export const e2eAttestaFindingsByScanId: Record<string, ScanFinding[]> = {
  [attestaScanWithFindingsId]: [
    {
      id: 'finding-rls',
      scan_id: attestaScanWithFindingsId,
      rule_id: 'supabase-rls',
      severity: 'error',
      file_path: 'db/migrations/003_create_auth_schema.up.sql',
      line_number: 1,
      message:
        "Supabase table 'organizations' is created but Row-Level Security (RLS) is not enabled.",
      created_at: '2026-06-26T08:55:00.000Z',
    },
  ],
  [attestaCleanScanId]: [
    {
      id: 'finding-clean',
      scan_id: attestaCleanScanId,
      rule_id: 'general',
      severity: 'warning',
      file_path: 'README.md',
      line_number: 1,
      message: 'Documentation could mention Ship Gate checks.',
      created_at: '2026-06-26T09:10:00.000Z',
    },
  ],
};

export const e2eLeaksFindings: ScanFinding[] = [
  {
    id: 'finding-leak',
    scan_id: e2eLeaksScan.id,
    rule_id: 'client-secret-leak',
    severity: 'error',
    file_path: 'src/config.ts',
    line_number: 12,
    message: 'Possible API key exposed in client-side bundle.',
    created_at: e2eLeaksScan.created_at,
  },
];

export function isE2eDashboardFixtureEnabled(): boolean {
  return process.env.E2E_DASHBOARD_FIXTURE === '1';
}

export function getE2eDashboardSession(): SessionResult | null {
  if (!isE2eDashboardFixtureEnabled()) {
    return null;
  }

  return {
    user: {
      id: 'e2e-user-1',
      name: 'E2E Dev',
      email: 'e2e@example.com',
      avatar_url: 'https://avatars.githubusercontent.com/u/9919?v=4',
    },
    organization: {
      id: 'org-1',
      name: 'acme',
      billing_plan: 'pro',
      github_installation_id: '140302856',
      created_at: '2026-06-21T00:00:00Z',
    },
    repositories: [e2eAttestaRepo, e2eLeaksRepo, e2eEmptyRepo],
  };
}

export function buildE2eSessionCookieValue(): string {
  return encodeURIComponent(
    JSON.stringify({
      accessToken: E2E_ACCESS_TOKEN,
      refreshToken: 'e2e-dashboard-refresh-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }),
  );
}

export function resolveE2eScansForRepo(repoId: string): Scan[] {
  if (repoId === e2eAttestaRepo.id) {
    return e2eAttestaScans;
  }
  if (repoId === e2eLeaksRepo.id) {
    return [e2eLeaksScan];
  }
  return [];
}

export function resolveE2eFindingsForScan(scanId: string): ScanFinding[] {
  if (scanId in e2eAttestaFindingsByScanId) {
    return e2eAttestaFindingsByScanId[scanId] ?? [];
  }
  if (scanId === e2eLeaksScan.id) {
    return e2eLeaksFindings;
  }
  return [];
}
