import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScannerFinding } from '@assurly/scanner-core';
import type { DbAdapter, FixOutcomeInput, FixOutcomeRow, Target } from '../../utils/dbAdapter';
import { resetRateLimitsForTests } from '../../utils/rateLimit';

/**
 * Phase 0 wiring proof: drive the REAL webhook + cron route handlers through to
 * a persisted `fix_outcome` row. Stub only the outermost boundaries
 * (`scanLiveUrlWithEvidence`, Next.js `after`, and the admin DB adapter).
 * Do NOT mock `reprobeTargetAndRecord`, `recordReprobeOutcomes`, or `guardian`.
 */

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  getAdminDbAdapter: vi.fn(),
  scanLiveUrlWithEvidence: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: mocks.after,
}));

vi.mock('../../utils/dbAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/dbAdapter')>();
  return {
    ...actual,
    getAdminDbAdapter: mocks.getAdminDbAdapter,
  };
});

vi.mock('../../utils/runtimeScanner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/runtimeScanner')>();
  return {
    ...actual,
    scanLiveUrlWithEvidence: mocks.scanLiveUrlWithEvidence,
  };
});

import { GET as guardianGET } from './cron/guardian/route';
import { POST as webhookPOST } from './vercel/webhook/route';

const WEBHOOK_SECRET = 'vercel-wiring-secret';
const CRON_SECRET = 'cron-wiring-secret';
const RULE_ID = 'runtime-supabase-rls-open';
const ORIGIN = 'https://dogfood.vercel.app';

function rlsFinding(): ScannerFinding {
  return { ruleId: RULE_ID, severity: 'error', message: 'RLS open' };
}

function makeTarget(overrides: Partial<Target> = {}): Target {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    organization_id: '22222222-2222-4222-8222-222222222222',
    kind: 'url',
    identifier: ORIGIN,
    display_name: 'Dogfood',
    repository_id: null,
    generator_fingerprint: 'lovable',
    ownership_verified: true,
    ownership_method: 'meta_tag',
    current_verdict: 'blocked',
    current_ship_score: 80,
    verdict_evidence: null,
    last_checked_at: null,
    badge_token: null,
    created_at: '2026-07-25T00:00:00.000Z',
    updated_at: '2026-07-25T00:00:00.000Z',
    ...overrides,
  };
}

function historyRow(
  target: Target,
  outcome: FixOutcomeRow['outcome'],
  createdAt = '2026-07-25T10:00:00.000Z',
): FixOutcomeRow {
  return {
    id: crypto.randomUUID(),
    organization_id: target.organization_id,
    target_id: target.id,
    scan_id: null,
    finding_rule_id: RULE_ID,
    generator_fingerprint: target.generator_fingerprint,
    fix_strategy: null,
    outcome,
    pr_url: null,
    deploy_id: null,
    created_at: createdAt,
  };
}

/**
 * In-memory admin DB that actually accumulates `fix_outcome` rows — the
 * assertion target of this suite. Other methods are no-op stubs sufficient for
 * the real webhook/cron → guardian path.
 */
function createMemoryDb(options: {
  target: Target | null;
  /** Seed rows returned by getFixOutcomesForTarget before the request. */
  history?: FixOutcomeRow[];
  /**
   * When set, listVerifiedUrlTargets returns this list (cron path).
   * Defaults to `[target]` when target is non-null.
   */
  cronTargets?: Target[];
}): DbAdapter & { outcomes: FixOutcomeRow[] } {
  const outcomes: FixOutcomeRow[] = [...(options.history ?? [])];
  let createdSeq = 0;

  const db = {
    outcomes,
    findVerifiedUrlTargetByOrigin: vi.fn(async (origin: string) => {
      if (!options.target) return null;
      return options.target.identifier === origin ? options.target : null;
    }),
    listVerifiedUrlTargets: vi.fn(async () => {
      if (options.cronTargets) return options.cronTargets;
      return options.target ? [options.target] : [];
    }),
    claimVercelDelivery: vi.fn(async () => true),
    finishVercelDelivery: vi.fn(async () => undefined),
    getFixOutcomesForTarget: vi.fn(async (targetId: string) =>
      outcomes.filter((row) => row.target_id === targetId),
    ),
    insertFixOutcomes: vi.fn(async (rows: FixOutcomeInput[]) => {
      for (const row of rows) {
        createdSeq += 1;
        outcomes.push({
          id: `fo-${createdSeq}`,
          organization_id: row.organizationId,
          target_id: row.targetId,
          scan_id: row.scanId ?? null,
          finding_rule_id: row.findingRuleId,
          generator_fingerprint: row.generatorFingerprint ?? null,
          fix_strategy: row.fixStrategy ?? null,
          outcome: row.outcome,
          pr_url: row.prUrl ?? null,
          deploy_id: row.deployId ?? null,
          // Monotonic timestamps so latestOutcomeByRule sees the newest write.
          created_at: new Date(Date.UTC(2026, 6, 25, 12, 0, createdSeq)).toISOString(),
        });
      }
    }),
    upsertTarget: vi.fn(async () => options.target ?? makeTarget()),
    getTargetAlertPrefs: vi.fn(async () => []),
    getOrganizationAdminEmails: vi.fn(async () => []),
  };

  return db as unknown as DbAdapter & { outcomes: FixOutcomeRow[] };
}

function sign(body: string, secret = WEBHOOK_SECRET): string {
  return crypto.createHmac('sha1', secret).update(body).digest('hex');
}

function webhookBody(deployId: string): string {
  return JSON.stringify({
    type: 'deployment.succeeded',
    payload: {
      deployment: { id: deployId, url: 'dogfood.vercel.app' },
      url: 'dogfood.vercel.app',
      target: 'production',
    },
  });
}

function webhookRequest(body: string): Request {
  return new Request('http://localhost/api/vercel/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vercel-signature': sign(body),
    },
    body,
  });
}

function cronRequest(): Request {
  return new Request('http://localhost/api/cron/guardian', {
    method: 'GET',
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

async function runWebhookBackground(): Promise<void> {
  expect(mocks.after).toHaveBeenCalled();
  const work = mocks.after.mock.calls[0][0] as () => Promise<void>;
  await work();
}

function outcomesForRule(db: { outcomes: FixOutcomeRow[] }): FixOutcomeRow[] {
  return db.outcomes.filter((row) => row.finding_rule_id === RULE_ID);
}

function latestOutcome(db: { outcomes: FixOutcomeRow[] }): FixOutcomeRow | undefined {
  const rows = outcomesForRule(db);
  return rows[rows.length - 1];
}

describe('fix_outcome wiring (route → insertFixOutcomes)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    process.env.VERCEL_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.CRON_SECRET = CRON_SECRET;
    mocks.scanLiveUrlWithEvidence.mockResolvedValue({ findings: [], evidence: [] });
  });

  describe('POST /api/vercel/webhook', () => {
    it('persists verified_fixed when a previously-open finding is gone after re-probe', async () => {
      const target = makeTarget();
      const db = createMemoryDb({ target, history: [historyRow(target, 'still_open')] });
      mocks.getAdminDbAdapter.mockReturnValue(db);
      mocks.scanLiveUrlWithEvidence.mockResolvedValue({ findings: [], evidence: [] });

      const body = webhookBody('dpl_fixed_1');
      expect((await webhookPOST(webhookRequest(body))).status).toBe(202);
      await runWebhookBackground();

      const row = latestOutcome(db);
      expect(row).toMatchObject({
        target_id: target.id,
        finding_rule_id: RULE_ID,
        outcome: 'verified_fixed',
        deploy_id: 'dpl_fixed_1',
      });
      expect(mocks.scanLiveUrlWithEvidence).toHaveBeenCalledWith(
        ORIGIN,
        expect.anything(),
        undefined,
        expect.objectContaining({ activeProbe: true }),
      );
    });

    it('persists still_open when a finding is present before and after re-probe', async () => {
      const target = makeTarget();
      // Prior `regressed` means the rule is open in the before-set; still present
      // after → still_open. (An unchanged still_open→still_open is intentionally
      // deduped and would write nothing — see recordReprobeOutcomes.)
      const db = createMemoryDb({ target, history: [historyRow(target, 'regressed')] });
      mocks.getAdminDbAdapter.mockReturnValue(db);
      mocks.scanLiveUrlWithEvidence.mockResolvedValue({
        findings: [rlsFinding()],
        evidence: [],
      });

      const body = webhookBody('dpl_open_1');
      expect((await webhookPOST(webhookRequest(body))).status).toBe(202);
      await runWebhookBackground();

      const row = latestOutcome(db);
      expect(row).toMatchObject({
        target_id: target.id,
        finding_rule_id: RULE_ID,
        outcome: 'still_open',
        deploy_id: 'dpl_open_1',
      });
    });

    it('persists regressed when a previously-fixed finding reappears', async () => {
      const target = makeTarget();
      const db = createMemoryDb({ target, history: [historyRow(target, 'verified_fixed')] });
      mocks.getAdminDbAdapter.mockReturnValue(db);
      mocks.scanLiveUrlWithEvidence.mockResolvedValue({
        findings: [rlsFinding()],
        evidence: [],
      });

      const body = webhookBody('dpl_regress_1');
      expect((await webhookPOST(webhookRequest(body))).status).toBe(202);
      await runWebhookBackground();

      const row = latestOutcome(db);
      expect(row).toMatchObject({
        target_id: target.id,
        finding_rule_id: RULE_ID,
        outcome: 'regressed',
        deploy_id: 'dpl_regress_1',
      });
    });

    it('does not persist an active-probe outcome for an ownership-unverified target', async () => {
      const target = makeTarget({ ownership_verified: false });
      const db = createMemoryDb({ target, history: [] });
      mocks.getAdminDbAdapter.mockReturnValue(db);
      mocks.scanLiveUrlWithEvidence.mockResolvedValue({
        findings: [rlsFinding()],
        evidence: [],
      });

      const body = webhookBody('dpl_unverified_1');
      expect((await webhookPOST(webhookRequest(body))).status).toBe(202);
      await runWebhookBackground();

      expect(outcomesForRule(db)).toHaveLength(0);
      expect(db.insertFixOutcomes).not.toHaveBeenCalled();
      expect(mocks.scanLiveUrlWithEvidence).toHaveBeenCalledWith(
        ORIGIN,
        expect.anything(),
        undefined,
        expect.objectContaining({ activeProbe: false }),
      );
    });
  });

  describe('GET /api/cron/guardian', () => {
    it('persists verified_fixed through the real cron → guardian → reprobe chain', async () => {
      const target = makeTarget();
      const db = createMemoryDb({ target, history: [historyRow(target, 'still_open')] });
      mocks.getAdminDbAdapter.mockReturnValue(db);
      mocks.scanLiveUrlWithEvidence.mockResolvedValue({ findings: [], evidence: [] });

      const response = await guardianGET(cronRequest());
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ checked: 1, skipped: 0 });

      expect(latestOutcome(db)).toMatchObject({
        target_id: target.id,
        finding_rule_id: RULE_ID,
        outcome: 'verified_fixed',
      });
    });

    it('persists still_open through the real cron chain when present before and after', async () => {
      const target = makeTarget();
      const db = createMemoryDb({ target, history: [historyRow(target, 'regressed')] });
      mocks.getAdminDbAdapter.mockReturnValue(db);
      mocks.scanLiveUrlWithEvidence.mockResolvedValue({
        findings: [rlsFinding()],
        evidence: [],
      });

      expect((await guardianGET(cronRequest())).status).toBe(200);
      expect(latestOutcome(db)).toMatchObject({ outcome: 'still_open' });
    });

    it('persists regressed through the real cron chain', async () => {
      const target = makeTarget();
      const db = createMemoryDb({ target, history: [historyRow(target, 'verified_fixed')] });
      mocks.getAdminDbAdapter.mockReturnValue(db);
      mocks.scanLiveUrlWithEvidence.mockResolvedValue({
        findings: [rlsFinding()],
        evidence: [],
      });

      expect((await guardianGET(cronRequest())).status).toBe(200);
      expect(latestOutcome(db)).toMatchObject({ outcome: 'regressed' });
    });

    it('does not persist an outcome when the cron candidate is ownership-unverified', async () => {
      const target = makeTarget({ ownership_verified: false });
      const db = createMemoryDb({
        target,
        history: [],
        // Simulate a list-filter miss: an unverified url still reaches the check.
        cronTargets: [target],
      });
      mocks.getAdminDbAdapter.mockReturnValue(db);
      mocks.scanLiveUrlWithEvidence.mockResolvedValue({
        findings: [rlsFinding()],
        evidence: [],
      });

      const response = await guardianGET(cronRequest());
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ checked: 0, skipped: 1 });

      expect(outcomesForRule(db)).toHaveLength(0);
      expect(db.insertFixOutcomes).not.toHaveBeenCalled();
      expect(mocks.scanLiveUrlWithEvidence).not.toHaveBeenCalled();
    });
  });
});
