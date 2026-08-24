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
    expect(formatSelectedRepoScanCount(0, 'loading')).toBe('Loading scans…');
    expect(formatSelectedRepoScanCount(4, 'loading')).toBe('4 scans');
    expect(formatSelectedRepoScanCount(0, 'empty')).toBe('No scans');
    expect(formatSelectedRepoScanCount(2, 'ready')).toBe('2 scans');
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

    const heading = screen.getByRole('heading', { name: 'tibco87/Attesta' });
    expect(heading).toBeTruthy();
    expect(screen.getByText('4 scans')).toBeTruthy();
    expect(heading.textContent).not.toMatch(/📁/);
    const label = heading.querySelector('.selected-repo-header__label');
    expect(label).toBeTruthy();
    expect(label?.getAttribute('title')).toBe('tibco87/Attesta');
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

  it('lets the user pick a scan branch', () => {
    const onScanBranchChange = vi.fn();
    render(
      <SelectedRepoHeader
        repoName="tibco87/SentinelLog"
        scanCount={0}
        canJumpToResults={false}
        onJumpToResults={vi.fn()}
        scanBranch="src"
        repoBranches={['src', 'main']}
        onScanBranchChange={onScanBranchChange}
      />,
    );

    const select = screen.getByTestId('scan-branch-select') as HTMLSelectElement;
    expect(select.value).toBe('src');
    fireEvent.change(select, { target: { value: 'main' } });
    expect(onScanBranchChange).toHaveBeenCalledWith('main');
  });

  it('marks the scan count as busy while repository details load', () => {
    render(
      <SelectedRepoHeader
        repoName="acme/api"
        scanCount={0}
        canJumpToResults={false}
        onJumpToResults={vi.fn()}
        repoDetailStatus="loading"
      />,
    );

    const meta = screen.getByText('Loading scans…');
    expect(meta).toBeTruthy();
    expect(meta.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText('No scans')).toBeNull();
  });
});
