// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShipGateGroupAction } from './ShipGateGroupAction';
import type { ShipGateAction } from '../../../utils/shipGate';

afterEach(() => {
  cleanup();
});

describe('ShipGateGroupAction', () => {
  it('renders the action label above the command for command actions', () => {
    const action: ShipGateAction = {
      label: 'Initialize CI workflow',
      kind: 'command',
      command: 'npx assurly init',
    };

    render(<ShipGateGroupAction action={action} />);

    const label = screen.getByText('Initialize CI workflow');
    const command = screen.getByText('npx assurly init');

    expect(label.className).toContain('ship-gate-action-label');
    expect(label.compareDocumentPosition(command) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: /copy command/i })).toBeTruthy();
  });

  it('renders the action label above the hint text for hint actions', () => {
    const action: ShipGateAction = {
      label: 'Enable row-level security',
      kind: 'hint',
      hint: 'Enable RLS on table users.',
    };

    render(<ShipGateGroupAction action={action} />);

    const label = screen.getByText('Enable row-level security');
    const hint = screen.getByText('Enable RLS on table users.');

    expect(label.className).toContain('ship-gate-action-label');
    expect(label.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('copies the hint text and confirms with a Copied state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const action: ShipGateAction = {
      label: 'Add security headers',
      kind: 'hint',
      hint: 'Add X-Content-Type-Options: nosniff to vercel.json.',
    };

    render(<ShipGateGroupAction action={action} />);

    const button = screen.getByRole('button', { name: /copy fix/i });
    expect(button.className).toContain('ship-gate-action-copy--secondary');
    expect(button.getAttribute('data-cta')).toBe('secondary');
    fireEvent.click(button);

    expect(writeText).toHaveBeenCalledWith('Add X-Content-Type-Options: nosniff to vercel.json.');
    expect(await screen.findByText(/copied/i)).toBeTruthy();
    expect(button.className).toContain('ship-gate-action-copy--copied');
  });
});
