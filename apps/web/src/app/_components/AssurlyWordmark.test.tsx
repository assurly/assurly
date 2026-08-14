// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ASSURLY_WORDMARK_ACCENT_CLASS, AssurlyWordmark } from './AssurlyWordmark';

afterEach(() => cleanup());

describe('AssurlyWordmark', () => {
  it('renders Ass·url·y with the brand accent on "url" by default', () => {
    const { container } = render(<AssurlyWordmark />);
    const root = container.firstElementChild;
    expect(root?.getAttribute('aria-hidden')).toBe('true');
    expect(root?.textContent).toBe('Assurly');
    const accent = root?.querySelector(`.${ASSURLY_WORDMARK_ACCENT_CLASS}`);
    expect(accent?.textContent).toBe('url');
  });

  it('allows an explicit accent class override', () => {
    const { container } = render(<AssurlyWordmark accentClassName="custom-accent" />);
    expect(container.querySelector('.custom-accent')?.textContent).toBe('url');
    expect(container.querySelector(`.${ASSURLY_WORDMARK_ACCENT_CLASS}`)).toBeNull();
  });
});
