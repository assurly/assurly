import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getAdminDbAdapter: vi.fn() }));
vi.mock('../../../../utils/dbAdapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../utils/dbAdapter')>()),
  getAdminDbAdapter: mocks.getAdminDbAdapter,
}));

import { GET } from './route';
import { resetRateLimitsForTests } from '../../../../utils/rateLimit';
import type { Target } from '../../../../utils/dbAdapter';

const TOKEN = 'a'.repeat(32);

function target(overrides: Partial<Target> = {}): Target {
  return {
    id: 'target-1',
    organization_id: 'org-1',
    kind: 'url',
    identifier: 'https://app.example.com',
    display_name: 'Example app',
    repository_id: null,
    generator_fingerprint: 'lovable',
    ownership_verified: true,
    ownership_method: 'meta_tag',
    current_verdict: 'blocked',
    current_ship_score: 80,
    verdict_evidence: { topIssue: { key: 'rls:invoices', severity: 'error' } },
    last_checked_at: '2026-07-18T06:00:00.000Z',
    badge_token: TOKEN,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-18T06:00:00.000Z',
    ...overrides,
  };
}

function useTarget(row: Target | null): void {
  mocks.getAdminDbAdapter.mockReturnValue({
    getTargetByBadgeToken: vi.fn().mockResolvedValue(row),
  });
}

function call(token = TOKEN, label?: string): Promise<Response> {
  const url = label
    ? `http://localhost/api/widget/${token}?label=${encodeURIComponent(label)}`
    : `http://localhost/api/widget/${token}`;
  return GET(new Request(url), { params: Promise.resolve({ token }) });
}

describe('GET /api/widget/[token] (OEM white-label widget)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
  });

  it('renders a shape-only SVG that never names the exposed table', async () => {
    useTarget(target());
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    const svg = await res.text();
    expect(svg).toContain('Security-checked by Assurly');
    // Stored 80, clamped to the blocked cap exactly as the dashboard clamps it.
    expect(svg).toContain('59/100');
    expect(svg).toContain('Database access control (RLS)');
    // Shape-only: the exposed table name is never in the widget.
    expect(svg).not.toContain('invoices');
  });

  it('applies a configurable branding label but strips injection', async () => {
    useTarget(target());
    const res = await call(TOKEN, '<script>Acme');
    const svg = await res.text();
    expect(svg).toContain('Acme');
    expect(svg).not.toContain('<script>');
  });

  it('404s for a malformed token', async () => {
    useTarget(target());
    const res = await call('not-a-token');
    expect(res.status).toBe(404);
  });

  it('404s when no published target backs the token', async () => {
    useTarget(null);
    const res = await call();
    expect(res.status).toBe(404);
  });
});
