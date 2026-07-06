// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DeployedUrlScan } from './DeployedUrlScan';

afterEach(cleanup);

function typeUrl(value: string): void {
  fireEvent.change(screen.getByLabelText('Deployed application URL'), { target: { value } });
}

function scanButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Scan URL' }) as HTMLButtonElement;
}

describe('DeployedUrlScan URL validation', () => {
  it('disables the button with no hint while the field is empty', () => {
    render(<DeployedUrlScan />);
    expect(scanButton().disabled).toBe(true);
    expect(screen.queryByText(/Enter a full URL/)).toBeNull();
  });

  it('disables the button and shows a hint for a malformed or scheme-less URL', () => {
    render(<DeployedUrlScan />);

    typeUrl('myapp.lovable.app'); // no scheme
    expect(scanButton().disabled).toBe(true);
    expect(screen.queryByText(/Enter a full URL including https:\/\//)).not.toBeNull();

    typeUrl('not a url');
    expect(scanButton().disabled).toBe(true);
    expect(screen.getByLabelText('Deployed application URL').getAttribute('aria-invalid')).toBe(
      'true',
    );
  });

  it('enables the button and hides the hint for a valid https URL', () => {
    render(<DeployedUrlScan />);

    typeUrl('https://myapp.lovable.app');
    expect(scanButton().disabled).toBe(false);
    expect(screen.queryByText(/Enter a full URL/)).toBeNull();
    expect(screen.getByLabelText('Deployed application URL').getAttribute('aria-invalid')).toBe(
      'false',
    );
  });
});
