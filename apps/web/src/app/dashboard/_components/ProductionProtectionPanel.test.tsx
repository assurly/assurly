// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UrlTargetDetail } from '../../../utils/clientApi';

const enableLiveLock = vi.hoisted(() => vi.fn());
const setLiveLockMode = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/clientApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/clientApi')>()),
  clientApi: { enableLiveLock, setLiveLockMode },
}));

import { ProductionProtectionPanel } from './ProductionProtectionPanel';

const TARGET_ID = '76cbe4db-d1a6-474f-b1c9-33bcebbc3f5e';
const SETUP: UrlTargetDetail['liveLockSetup'] = {
  vercelConfigured: true,
  vercelConnected: false,
  projectName: null,
  mode: null,
};

type Check = UrlTargetDetail['liveLockChecks'][number];

function check(overrides: Partial<Check> = {}): Check {
  return {
    deploymentId: 'dpl_abc',
    deploymentUrl: 'https://app-abc.vercel.app',
    gitSha: 'abc1234def',
    blocking: true,
    status: 'completed',
    conclusion: 'succeeded',
    reason: 'clear',
    shipScore: 92,
    blockers: [],
    checkedAt: '2026-10-24T10:00:00.000Z',
    ...overrides,
  };
}

function renderPanel(
  setup: Partial<UrlTargetDetail['liveLockSetup']> = {},
  checks: Check[] = [],
  onChanged = vi.fn(),
) {
  render(
    <ProductionProtectionPanel
      targetId={TARGET_ID}
      ownershipVerified
      setup={{ ...SETUP, ...setup }}
      checks={checks}
      onChanged={onChanged}
    />,
  );
  return { onChanged };
}

const NO_RESULT = { installUrl: null, projects: [], projectName: null, mode: null };

describe('ProductionProtectionPanel', () => {
  beforeEach(() => {
    enableLiveLock.mockReset();
    setLiveLockMode.mockReset();
  });

  it('renders nothing for an unverified URL', () => {
    const { container } = render(
      <ProductionProtectionPanel
        targetId={TARGET_ID}
        ownershipVerified={false}
        setup={SETUP}
        checks={[]}
        onChanged={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('opens the Vercel install in its own window and refreshes on return', async () => {
    enableLiveLock.mockResolvedValue({
      ...NO_RESULT,
      status: 'vercel_required',
      installUrl: 'https://vercel.com/integrations/assurly-live-lock/new?state=s',
    });
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const { onChanged } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /protect production deploys/i }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(open.mock.calls[0]?.[0]).toBe(
      'https://vercel.com/integrations/assurly-live-lock/new?state=s',
    );

    window.dispatchEvent(new Event('focus'));
    expect(onChanged).toHaveBeenCalled();
    open.mockRestore();
  });

  it('lets the user pick the project when none lists the domain', async () => {
    enableLiveLock
      .mockResolvedValueOnce({
        ...NO_RESULT,
        status: 'vercel_project_required',
        projects: [{ id: 'prj_app', name: 'app' }],
      })
      .mockResolvedValueOnce({
        ...NO_RESULT,
        status: 'active',
        projectName: 'app',
        mode: 'monitor',
      });
    const { onChanged } = renderPanel({ vercelConnected: true });

    fireEvent.click(screen.getByRole('button', { name: /protect production deploys/i }));
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'prj_app' } });
    fireEvent.click(screen.getByRole('button', { name: /use this project/i }));

    await waitFor(() => expect(enableLiveLock).toHaveBeenLastCalledWith(TARGET_ID, 'prj_app'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('moves from monitor to enforce', async () => {
    setLiveLockMode.mockResolvedValue({ mode: 'enforce' });
    const { onChanged } = renderPanel({
      vercelConnected: true,
      projectName: 'app',
      mode: 'monitor',
    });

    expect(screen.getByText(/Monitoring app/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /hold back blocked deploys/i }));
    await waitFor(() => expect(setLiveLockMode).toHaveBeenCalledWith(TARGET_ID, 'enforce'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('says what each recent deploy got', () => {
    renderPanel({ vercelConnected: true, projectName: 'app', mode: 'enforce' }, [
      check({ deploymentId: 'dpl_1', conclusion: 'succeeded' }),
      check({
        deploymentId: 'dpl_2',
        conclusion: 'failed',
        reason: 'runtime_blocker',
        blockers: [{ ruleId: 'rls', message: 'Table profiles is readable.', location: 'runtime' }],
      }),
      check({ deploymentId: 'dpl_3', conclusion: 'neutral', reason: 'deployment_protected' }),
      check({
        deploymentId: 'dpl_4',
        blocking: false,
        conclusion: 'neutral',
        reason: 'runtime_blocker',
      }),
    ]);
    expect(screen.getByText('Passed')).toBeTruthy();
    expect(screen.getByText('Held back')).toBeTruthy();
    expect(screen.getByText('Table profiles is readable.')).toBeTruthy();
    expect(screen.getByText(/Deployment Protection kept Assurly out/)).toBeTruthy();
    expect(screen.getByText('Would be held back')).toBeTruthy();
  });
});
