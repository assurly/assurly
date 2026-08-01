// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ManualChecker from './ManualChecker';

afterEach(() => {
  cleanup();
});

describe('ManualChecker project tab', () => {
  it('renders ZIP / folder CTAs with lucide icons and no emoji copy', () => {
    render(<ManualChecker onToast={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: /Project Folder \/ ZIP/i }));

    const folderBtn = screen.getByRole('button', { name: /Select Project Folder/i });
    const zipBtn = screen.getByRole('button', { name: /Upload ZIP Archive/i });

    expect(folderBtn.textContent).toMatch(/Select Project Folder/);
    expect(zipBtn.textContent).toMatch(/Upload ZIP Archive/);
    expect(folderBtn.textContent).not.toMatch(/📁|📂|📦/);
    expect(zipBtn.textContent).not.toMatch(/📁|📂|📦/);
    expect(folderBtn.querySelector('svg.dashboard-icon')).toBeTruthy();
    expect(zipBtn.querySelector('svg.dashboard-icon')).toBeTruthy();
  });
});
