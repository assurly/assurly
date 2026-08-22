import { describe, expect, it, vi } from 'vitest';
import {
  isNestedReadme,
  prefetchPublicScanFiles,
  PublicScanRateLimitError,
} from './publicScanPrefetch';

describe('isNestedReadme', () => {
  it('keeps the repository-root README and skips docs READMEs', () => {
    expect(isNestedReadme('README.md')).toBe(false);
    expect(isNestedReadme('images/arch/README.md')).toBe(true);
    expect(isNestedReadme('packages/sandbox/README.md')).toBe(true);
  });
});

describe('prefetchPublicScanFiles', () => {
  it('loads every path from a single batch POST', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/github/public-scan');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body)) as { paths: string[] };
      expect(body.paths).toEqual(['package.json', 'src/app.ts']);
      return new Response(
        JSON.stringify({
          files: [
            { path: 'package.json', content: '{"name":"app"}' },
            { path: 'src/app.ts', content: 'export {}' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const files = await prefetchPublicScanFiles({
      repo: 'vercel/sandbox',
      branch: 'main',
      paths: ['package.json', 'src/app.ts'],
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(files.get('package.json')).toBe('{"name":"app"}');
    expect(files.get('src/app.ts')).toBe('export {}');
  });

  it('falls back to per-file GET when the batch endpoint fails', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/github/public-scan') {
        return new Response('nope', { status: 500 });
      }
      if (url.includes('path=src%2Fapp.ts')) {
        return new Response('export const ok = true;', { status: 200 });
      }
      return new Response('missing', { status: 404 });
    });

    const files = await prefetchPublicScanFiles({
      repo: 'vercel/sandbox',
      branch: 'main',
      paths: ['src/app.ts', 'missing.ts'],
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(files.get('src/app.ts')).toBe('export const ok = true;');
    expect(files.get('missing.ts')).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('throws on GitHub rate limits instead of retrying file-by-file', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'GitHub API rate limit exceeded.' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    await expect(
      prefetchPublicScanFiles({
        repo: 'vercel/sandbox',
        branch: 'main',
        paths: ['src/app.ts'],
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(PublicScanRateLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
