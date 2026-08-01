// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeployedUrlScan, DeployedUrlScanCard, useDeployedUrlScan } from './DeployedUrlScan';
import type { ReactElement } from 'react';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function typeUrl(value: string): void {
  fireEvent.change(screen.getByLabelText('Deployed application URL'), { target: { value } });
}

function scanButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Scan URL' }) as HTMLButtonElement;
}

describe('DeployedUrlScan URL validation', () => {
  it('disables the button with no hint while the field is empty', () => {
    render(<DeployedUrlScan />);
    expect(scanButton().disabled).toBe(true);
    expect(screen.queryByText(/Enter a full URL/)).toBeNull();
  });

  it('disables the button and shows a hint for a malformed or scheme-less URL', () => {
    render(<DeployedUrlScan />);

    typeUrl('myapp.lovable.app'); // no scheme
    expect(scanButton().disabled).toBe(true);
    expect(screen.queryByText(/Enter a full URL including https:\/\//)).not.toBeNull();

    typeUrl('not a url');
    expect(scanButton().disabled).toBe(true);
    expect(screen.getByLabelText('Deployed application URL').getAttribute('aria-invalid')).toBe(
      'true',
    );
  });

  it('enables the button and hides the hint for a valid https URL', () => {
    render(<DeployedUrlScan />);

    typeUrl('https://myapp.lovable.app');
    expect(scanButton().disabled).toBe(false);
    expect(screen.queryByText(/Enter a full URL/)).toBeNull();
    expect(screen.getByLabelText('Deployed application URL').getAttribute('aria-invalid')).toBe(
      'false',
    );
  });
});

describe('DeployedUrlScan deep review surface', () => {
  it('renders the Layer-2 deep review panel when the API returns one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          report: {
            status: 'review',
            shipScore: 96,
            headline: 'REVIEW RECOMMENDED',
            statusEmoji: '⚠️',
            blockers: [],
            reviews: [],
            warnings: [],
            cleanFileCount: 0,
            scannedFileCount: 1,
            totalErrorFindings: 0,
            totalWarningFindings: 1,
          },
          findings: [
            {
              ruleId: 'runtime-missing-security-headers',
              severity: 'warning',
              message: 'Missing security headers.',
              file: 'HTTP response',
            },
          ],
          evidence: [],
          target: { id: 't1', ownershipVerified: false },
          deepReview: {
            summary: 'Header gaps enable XSS and clickjacking on payment flows.',
            findings: [
              {
                title: 'Absent CSP enables XSS',
                risk: 'Attacker script can steal session tokens.',
                recommendation: 'Deploy a strict CSP with nonces.',
              },
            ],
            source: 'ai',
          },
        }),
      ),
    );

    render(<DeployedUrlScan />);
    typeUrl('https://myapp.example');
    fireEvent.click(scanButton());

    await waitFor(() => {
      expect(screen.getByTestId('deep-review')).toBeTruthy();
    });
    expect(screen.getByText('AI deep review')).toBeTruthy();
    expect(screen.getByText('1 deep risk')).toBeTruthy();
    expect(
      screen.getByText('Header gaps enable XSS and clickjacking on payment flows.'),
    ).toBeTruthy();
    expect(screen.getByText('Absent CSP enables XSS')).toBeTruthy();
  });

  it('shows a "verify to unlock" teaser when deep review is ownership-locked (Pro, unverified)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          report: {
            status: 'review',
            shipScore: 92,
            headline: 'REVIEW RECOMMENDED',
            statusEmoji: '⚠️',
            blockers: [],
            reviews: [],
            warnings: [],
            cleanFileCount: 0,
            scannedFileCount: 1,
            totalErrorFindings: 0,
            totalWarningFindings: 1,
          },
          findings: [
            {
              ruleId: 'runtime-supabase-key-exposed',
              severity: 'warning',
              message: 'DB reachable.',
              file: 'Public app bundle',
            },
          ],
          evidence: [],
          target: { id: 't1', ownershipVerified: false },
          deepReviewLocked: true,
        }),
      ),
    );

    render(<DeployedUrlScan />);
    typeUrl('https://myapp.example');
    fireEvent.click(scanButton());

    await waitFor(() => {
      expect(screen.getByTestId('deep-review-locked')).toBeTruthy();
    });
    // The heavyweight panel is NOT rendered — only the teaser.
    expect(screen.queryByTestId('deep-review')).toBeNull();
    expect(screen.getByText(/Guard this URL and verify ownership above to unlock/)).toBeTruthy();
  });

  it('shows Guard this URL CTA for one-off probes (target null)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          report: {
            status: 'review',
            shipScore: 84,
            headline: 'NOT READY TO SHIP',
            statusEmoji: '🚫',
            blockers: [],
            reviews: [],
            warnings: [],
            cleanFileCount: 0,
            scannedFileCount: 1,
            totalErrorFindings: 1,
            totalWarningFindings: 1,
          },
          findings: [],
          evidence: [],
          target: null,
        }),
      ),
    );

    render(<DeployedUrlScan />);
    typeUrl('https://fastshare.example');
    fireEvent.click(scanButton());

    await waitFor(() => {
      expect(screen.getByTestId('guard-url-cta')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Guard this URL' })).toBeTruthy();
    expect(screen.getByText('Save to Your apps')).toBeTruthy();
  });

  it('omits the deep review panel when the API returns none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          report: {
            status: 'ready',
            shipScore: 100,
            headline: 'READY TO SHIP',
            statusEmoji: '✅',
            blockers: [],
            reviews: [],
            warnings: [],
            cleanFileCount: 1,
            scannedFileCount: 1,
            totalErrorFindings: 0,
            totalWarningFindings: 0,
          },
          findings: [],
          evidence: [],
          target: null,
        }),
      ),
    );

    render(<DeployedUrlScan />);
    typeUrl('https://myapp.example');
    fireEvent.click(scanButton());

    await waitFor(() => {
      expect(screen.getByText(/Ship Gate for/)).toBeTruthy();
    });
    expect(screen.queryByTestId('deep-review')).toBeNull();
  });
});

describe('useDeployedUrlScan onScanComplete', () => {
  function Harness({ onComplete }: { onComplete: () => void }): ReactElement {
    const scan = useDeployedUrlScan(undefined, onComplete);
    return <DeployedUrlScanCard scan={scan} />;
  }

  it('notifies the dashboard after a successful scan so verdict cards can refresh', async () => {
    const onComplete = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          report: {
            status: 'ready',
            shipScore: 100,
            headline: 'READY TO SHIP',
            statusEmoji: '✅',
            blockers: [],
            reviews: [],
            warnings: [],
            cleanFileCount: 1,
            scannedFileCount: 1,
            totalErrorFindings: 0,
            totalWarningFindings: 0,
          },
          findings: [],
          evidence: [],
          target: { id: 'target-1', ownershipVerified: false },
        }),
      ),
    );

    render(<Harness onComplete={onComplete} />);
    typeUrl('https://myapp.example');
    fireEvent.click(scanButton());

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });
});
