// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn(), select: vi.fn() }));
vi.mock('../../../utils/clientApi', () => ({
  clientApi: { workspaces: { list: mocks.list, select: mocks.select } },
}));

import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const two = [
  { id: ORG_A, name: 'Personal', billing_plan: 'pro' as const, role: 'admin' as const },
  { id: ORG_B, name: 'Acme', billing_plan: 'free' as const, role: 'member' as const },
];

describe('WorkspaceSwitcher', () => {
  const reload = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('location', { ...window.location, reload });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders nothing for a single workspace', () => {
    const { container } = render(<WorkspaceSwitcher workspaces={[two[0]!]} activeId={ORG_A} />);
    expect(container.innerHTML).toBe('');
  });

  it('switches and reloads the dashboard', async () => {
    mocks.select.mockResolvedValue({ activeId: ORG_B });
    render(<WorkspaceSwitcher workspaces={two} activeId={ORG_A} />);
    const select = screen.getByLabelText('Switch workspace') as HTMLSelectElement;
    expect(select.value).toBe(ORG_A);
    fireEvent.change(select, { target: { value: ORG_B } });
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(mocks.select).toHaveBeenCalledWith(ORG_B);
  });

  it('keeps the active workspace and says so when the switch fails', async () => {
    mocks.select.mockRejectedValue(new Error('500'));
    render(<WorkspaceSwitcher workspaces={two} activeId={ORG_A} />);
    const select = screen.getByLabelText('Switch workspace') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: ORG_B } });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(select.value).toBe(ORG_A);
    expect(select.disabled).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('appears in the workspace header once the list loads', async () => {
    mocks.list.mockResolvedValue({ organizations: two, activeId: ORG_A });
    render(<WorkspaceHeader orgName="Personal" billingPlan="pro" />);
    expect((await screen.findAllByLabelText('Switch workspace')).length).toBeGreaterThan(0);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });
});
