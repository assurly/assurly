// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectLoadStatus } from './ProjectLoadStatus';

afterEach(() => {
  cleanup();
});

describe('ProjectLoadStatus', () => {
  it('renders folder copy with live status region', () => {
    render(<ProjectLoadStatus kind="folder" label="shipready" variant="placeholder" />);

    const status = screen.getByTestId('project-load-status');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText(/Reading project folder/i)).toBeTruthy();
    expect(screen.getByText('shipready')).toBeTruthy();
  });

  it('renders ZIP and drop titles', () => {
    const { rerender } = render(<ProjectLoadStatus kind="zip" label="app.zip" variant="overlay" />);
    expect(screen.getByText(/Unpacking ZIP archive/i)).toBeTruthy();

    rerender(<ProjectLoadStatus kind="drop" label="my-app" variant="overlay" />);
    expect(screen.getByText(/Reading dropped files/i)).toBeTruthy();
  });
});
