// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatSelectedRepoScanCount, SelectedRepoHeader } from './SelectedRepoHeader';

afterEach(() => {
  cleanup();
});

describe('SelectedRepoHeader', () => {
  it('formats scan count labels', () => {
    expect(formatSelectedRepoScanCount(0)).toBe('No scans');
    expect(formatSelectedRepoScanCount(1)).toBe('1 scan');
    expect(formatSelectedRepoScanCount(3)).toBe('3 scans');
  });

  it('renders the selected repository name and scan count', () => {
    render(
      <SelectedRepoHeader
        repoName="tibco87/Attesta"
        scanCount={4}
        canJumpToResults={false}
        onJumpToResults={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'tibco87/Attesta' })).toBeTruthy();
    expect(screen.getByText('4 scans')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'tibco87/Attesta' }).textContent).not.toMatch(/📁/);
  });

  it('calls onJumpToResults when Jump to results is clicked', () => {
    const onJumpToResults = vi.fn();

    render(
      <SelectedRepoHeader
        repoName="react-client-leaks"
        scanCount={2}
        canJumpToResults={true}
        onJumpToResults={onJumpToResults}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /jump to results/i }));
    expect(onJumpToResults).toHaveBeenCalledTimes(1);
  });

  it('hides Jump to results when results are not ready', () => {
    render(
      <SelectedRepoHeader
        repoName="empty-repo"
        scanCount={0}
        canJumpToResults={false}
        onJumpToResults={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /jump to results/i })).toBeNull();
  });
});
