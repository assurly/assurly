// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

/**
 * Pins the global cleanup in vitest.setup.ts: without it a tree rendered in
 * one test stays mounted, with any timers it holds, past the end of the file.
 * Tests in a file run in order, so the second one sees what the first left.
 */
describe('global Testing Library cleanup', () => {
  it('renders a tree and does not unmount it itself', () => {
    render(<a href="/privacy">Privacy</a>);
    expect(document.body.textContent).toContain('Privacy');
  });

  it('starts the next test with an empty document', () => {
    expect(document.body.innerHTML).toBe('');
  });
});
