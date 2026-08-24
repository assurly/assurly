import { afterEach, describe, expect, it, vi } from 'vitest';
import sitemap from './sitemap';

describe('sitemap', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lists public pages with a slashed homepage and slash-free inner paths', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('APP_URL', 'https://assurly.dev');

    expect(sitemap().map((entry) => entry.url)).toEqual([
      'https://assurly.dev/',
      'https://assurly.dev/mcp',
      'https://assurly.dev/trust',
      'https://assurly.dev/privacy',
      'https://assurly.dev/terms',
    ]);
  });
});
