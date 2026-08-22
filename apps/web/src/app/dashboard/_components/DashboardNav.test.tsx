// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardNav } from './DashboardNav';

afterEach(() => cleanup());

describe('DashboardNav', () => {
  it('renders Apps, Manual Checker, and Settings as compact controls', () => {
    const onNavigate = vi.fn();
    render(<DashboardNav active="apps" onNavigate={onNavigate} />);

    expect(screen.getByRole('button', { name: 'Apps' }).className).toContain('active');
    expect(screen.getByRole('button', { name: 'Manual Checker' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onNavigate).toHaveBeenCalledWith('settings');
  });
});
