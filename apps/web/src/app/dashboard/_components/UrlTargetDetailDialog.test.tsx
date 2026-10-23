// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TargetCard, UrlTargetDetail } from '../../../utils/clientApi';

const targetDetail = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/clientApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/clientApi')>()),
  clientApi: { targetDetail, enableLiveLock: vi.fn() },
}));

import { UrlTargetDetailDialog } from './UrlTargetDetailDialog';

const CARD: TargetCard = {
  id: '76cbe4db-d1a6-474f-b1c9-33bcebbc3f5e',
  kind: 'url',
  identifier: 'https://assurly-live-target.vercel.app',
  displayName: 'assurly-live-target.vercel.app',
  repositoryId: null,
  generatorFingerprint: null,
  verdict: 'blocked',
  shipScore: 59,
  topIssue: null,
  lastCheckedAt: '2026-10-23T06:34:55.908Z',
  latestScanId: null,
  ownershipVerified: true,
  guardianEnabled: true,
  scoreDropped: false,
  badgeToken: null,
  scanCapability: 'browser',
  lastScanFailed: false,
  lastScanFailureReason: null,
  checkedCommitSha: null,
  headCommitSha: null,
};

const OPEN_DETAIL: UrlTargetDetail = {
  id: CARD.id,
  identifier: CARD.identifier,
  displayName: CARD.displayName,
  verdict: 'blocked',
  shipScore: 59,
  lastCheckedAt: '2026-10-23T06:34:55.908Z',
  ownershipVerified: true,
  blockers: [
    {
      ruleId: 'runtime-supabase-rls-open',
      message: "Supabase table 'customers' returned rows via anon key without RLS protection.",
      location: 'Supabase REST API · customers',
      evidence: {
        findingRuleId: 'runtime-supabase-rls-open',
        kind: 'rls_rows',
        summary: 'We read 3 rows from your `customers` table using only the public key.',
        redactedSample: {
          table: 'customers',
          rowCount: 3,
          columns: ['id', 'name', 'email', 'note'],
          sampleCell: '7***',
        },
        checkedAt: '2026-10-23T06:34:55.501Z',
      },
      outcome: {
        status: 'still_open',
        since: '2026-09-20T16:50:16.547Z',
        foundAt: '2026-09-20T16:50:16.547Z',
      },
    },
  ],
  liveLock: {
    status: 'blocked',
    shipScore: 59,
    reason: 'runtime_blocker',
    gitSha: 'abc1234def',
    checkedAt: '2026-10-23T07:00:00.000Z',
    stoppedDeploy: true,
  },
  liveLockSetup: {
    repositoryName: 'acme/app',
    vercelConnected: false,
    locked: false,
    pullRequestUrl: null,
  },
  otherEvidence: [
    {
      findingRuleId: 'runtime-missing-security-headers',
      kind: 'missing_header',
      summary:
        'Your app is missing 2 protective headers: X-Content-Type-Options, Content-Security-Policy.',
      checkedAt: '2026-10-23T06:34:55.501Z',
    },
  ],
};

function renderDialog(overrides: Partial<Parameters<typeof UrlTargetDetailDialog>[0]> = {}) {
  const props = {
    card: CARD,
    onClose: vi.fn(),
    onRescan: vi.fn().mockResolvedValue(undefined),
    rescanning: false,
    rescanBlocked: false,
    ...overrides,
  };
  render(<UrlTargetDetailDialog {...props} />);
  return props;
}

beforeEach(() => {
  targetDetail.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('UrlTargetDetailDialog', () => {
  it('shows which table was read, how many rows, and when', async () => {
    targetDetail.mockResolvedValue(OPEN_DETAIL);
    renderDialog();

    expect(
      await screen.findByText(
        'We read 3 rows from your `customers` table using only the public key.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('customers')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('id, name, email, note')).toBeTruthy();
    expect(screen.getByText('7***')).toBeTruthy();
    expect(screen.getByText(/Proof taken/)).toBeTruthy();
    expect(screen.getByText('Still open')).toBeTruthy();
    expect(screen.getByText(/Also seen · not blocking/)).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).toContain('Not ready to ship · 59/100');
  });

  it('re-runs the same check and shows the verified fix it proved', async () => {
    targetDetail.mockResolvedValueOnce(OPEN_DETAIL).mockResolvedValueOnce({
      ...OPEN_DETAIL,
      verdict: 'review',
      shipScore: 96,
      blockers: [
        {
          ...OPEN_DETAIL.blockers[0],
          evidence: null,
          outcome: {
            status: 'verified_fixed',
            since: '2026-10-23T08:00:00.000Z',
            foundAt: '2026-09-20T16:50:16.547Z',
          },
        },
      ],
    });
    const props = renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Run the same check again' }));

    await waitFor(() => expect(props.onRescan).toHaveBeenCalledWith(CARD));
    expect(await screen.findByText('Verified fixed')).toBeTruthy();
    expect(targetDetail).toHaveBeenCalledTimes(2);
  });

  it('explains why an unverified URL cannot re-run the data check', async () => {
    targetDetail.mockResolvedValue({ ...OPEN_DETAIL, ownershipVerified: false });
    renderDialog({ card: { ...CARD, ownershipVerified: false } });

    expect(
      await screen.findByText(/Verify you own this URL to re-run the data check/),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Run the same check again' })).toBeNull();
  });

  it('closes on Escape', async () => {
    targetDetail.mockResolvedValue(OPEN_DETAIL);
    const props = renderDialog();
    await screen.findByText('Still open');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('shows that Live Lock stopped a deploy', async () => {
    targetDetail.mockResolvedValue(OPEN_DETAIL);
    renderDialog();
    expect(await screen.findByTestId('live-lock')).toBeTruthy();
    expect(screen.getByText(/Live Lock stopped a deploy/)).toBeTruthy();
  });

  it('says Live Lock has not been called when there is no attempt', async () => {
    targetDetail.mockResolvedValue({
      ...OPEN_DETAIL,
      liveLock: {
        status: null,
        shipScore: null,
        reason: null,
        gitSha: null,
        checkedAt: null,
        stoppedDeploy: false,
      },
    });
    renderDialog();
    expect(await screen.findByText(/No deploy has called Live Lock/)).toBeTruthy();
  });

  it('says so when the proof cannot be loaded', async () => {
    targetDetail.mockRejectedValue(new Error('network'));
    renderDialog();

    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not load the proof/);
  });
});
