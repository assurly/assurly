import path from 'node:path';
import { describe, expect, it } from 'vitest';
import nextConfig from './next.config';

describe('Next.js production configuration', () => {
  it('pins Turbopack to the monorepo workspace root', () => {
    expect(nextConfig.turbopack?.root).toBe(path.resolve(import.meta.dirname, '../..'));
  });

  it('applies defense-in-depth response headers', async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const rules = await nextConfig.headers?.();
    const headers = new Map(rules?.[0]?.headers.map(({ key, value }) => [key, value]));
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Permissions-Policy')).toContain('camera=()');
  });
});
