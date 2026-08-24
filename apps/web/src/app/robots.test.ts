import { afterEach, describe, expect, it, vi } from 'vitest';
import robots from './robots';

describe('robots', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('points crawlers at the same origin the sitemap uses', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('APP_URL', 'https://assurly.dev');

    expect(robots().sitemap).toBe('https://assurly.dev/sitemap.xml');
  });
});
