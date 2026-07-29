// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatVerifiedFixTime, VerifiedFixTimeline } from './VerifiedFixTimeline';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('formatVerifiedFixTime', () => {
  it('returns the pinned en-US timestamp for a fixed ISO input', () => {
    const iso = '2026-07-16T14:03:00.000Z';
    const expected = new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(formatVerifiedFixTime(iso)).toBe(expected);
    expect(formatVerifiedFixTime(null)).toBeNull();
    expect(formatVerifiedFixTime('not-a-date')).toBeNull();
  });

  it('passes en-US explicitly so ambient locale cannot change the output', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleString');
    formatVerifiedFixTime('2026-07-16T14:03:00.000Z');
    expect(spy).toHaveBeenCalledWith('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  });
});

describe('VerifiedFixTimeline', () => {
  it('renders the VERIFIED FIXED badge and the full found → fixed → verified trail', () => {
    render(
      <VerifiedFixTimeline
        outcome="verified_fixed"
        foundAt="2026-07-16T14:03:00Z"
        prUrl="https://github.com/acme/app/pull/12"
        prLabel="PR #12"
        verifiedAt="2026-07-16T14:40:00Z"
      />,
    );

    expect(screen.getByTestId('verified-fix-badge').textContent).toMatch(/verified fixed/i);
    expect(screen.getByText('Found')).toBeTruthy();
    expect(screen.getByText('verified closed')).toBeTruthy();
    const link = screen.getByRole('link', { name: /PR #12/ });
    expect(link.getAttribute('href')).toBe('https://github.com/acme/app/pull/12');
  });

  it('labels a still-open outcome as "last checked" and omits a missing PR link', () => {
    render(<VerifiedFixTimeline outcome="still_open" verifiedAt="2026-07-16T14:40:00Z" />);

    expect(screen.getByTestId('verified-fix-badge').textContent).toMatch(/still open/i);
    expect(screen.getByText('last checked')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('marks a regression distinctly', () => {
    const { container } = render(<VerifiedFixTimeline outcome="regressed" />);
    expect(screen.getByTestId('verified-fix-badge').textContent).toMatch(/regressed/i);
    expect(container.querySelector('.verified-fix--regressed')).toBeTruthy();
  });
});
