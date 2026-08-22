// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactElement } from 'react';
import { PublicRepoConnect } from './PublicRepoConnect';

afterEach(() => {
  cleanup();
});

function Harness({
  connectError = null,
  onSubmit = vi.fn(),
}: {
  connectError?: string | null;
  onSubmit?: () => void;
}): ReactElement {
  const [value, setValue] = useState('');
  return (
    <PublicRepoConnect
      publicRepoInput={value}
      isAddingRepo={false}
      connectError={connectError}
      onInputChange={setValue}
      onSubmit={onSubmit}
    />
  );
}

function typeRepo(value: string): void {
  fireEvent.change(screen.getByLabelText('Public GitHub repository'), { target: { value } });
}

function connectButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Connect & Scan' }) as HTMLButtonElement;
}

describe('PublicRepoConnect validation', () => {
  it('disables the button with no hint while the field is empty', () => {
    render(<Harness />);
    expect(connectButton().disabled).toBe(true);
    expect(screen.queryByText(/Enter owner\/repo/)).toBeNull();
  });

  it('disables the button and shows a hint for not-a-repo', () => {
    render(<Harness />);

    typeRepo('not-a-repo');
    expect(connectButton().disabled).toBe(true);
    expect(screen.getByText(/Enter owner\/repo — for example facebook\/react/)).toBeTruthy();
    expect(screen.getByLabelText('Public GitHub repository').getAttribute('aria-invalid')).toBe(
      'true',
    );
  });

  it('enables the button and hides the hint for owner/repo and GitHub URLs', () => {
    render(<Harness />);

    typeRepo('facebook/react');
    expect(connectButton().disabled).toBe(false);
    expect(screen.queryByText(/Enter owner\/repo/)).toBeNull();
    expect(screen.getByLabelText('Public GitHub repository').getAttribute('aria-invalid')).toBe(
      'false',
    );

    typeRepo('https://github.com/facebook/react');
    expect(connectButton().disabled).toBe(false);
    expect(screen.queryByText(/Enter owner\/repo/)).toBeNull();
  });

  it('surfaces an inline connect error in the card', () => {
    render(
      <Harness connectError="Repository not found. Use the owner/repo format for a public repository." />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Repository not found');
  });
});
