import { afterEach, describe, expect, it, vi } from 'vitest';
import { INSTANT_GATE_MAX_FILES } from '@assurly/scanner-core';
import {
  clearInstantGateTreeCacheForTests,
  loadInstantGateTree,
  selectInstantGateTreeEntries,
} from './instantGateTree';

describe('selectInstantGateTreeEntries', () => {
  it('drops GitHub metadata, unreadable paths, and ranks Instant Gate files', () => {
    const selected = selectInstantGateTreeEntries(
      [
        {
          path: 'apps/web/src/app/api/stripe/webhook/route.ts',
          type: 'blob',
          sha: 'abc',
          url: 'https://api.github.com/repos/acme/app/git/blobs/abc',
        },
        { path: 'node_modules/react/index.js', type: 'blob' },
        { path: 'README.md', type: 'blob' },
        { path: 'apps', type: 'tree', sha: 'dir' },
      ],
      false,
    );

    expect(selected.tree.every((entry) => entry.type === 'blob')).toBe(true);
    expect(selected.tree.some((entry) => 'sha' in entry && entry.sha)).toBe(false);
    expect(selected.tree.map((entry) => entry.path)).toContain(
      'apps/web/src/app/api/stripe/webhook/route.ts',
    );
    expect(selected.tree.map((entry) => entry.path)).not.toContain('node_modules/react/index.js');
  });

  it('caps the tree at INSTANT_GATE_MAX_FILES and marks truncated', () => {
    const entries = Array.from({ length: INSTANT_GATE_MAX_FILES + 20 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      type: 'blob' as const,
    }));
    const selected = selectInstantGateTreeEntries(entries);
    expect(selected.tree).toHaveLength(INSTANT_GATE_MAX_FILES);
    expect(selected.truncated).toBe(true);
  });

  /**
   * The sample that leaves this function is all the browser ever sees, so the
   * repository-wide counts have to travel with it. Without them a capped scan
   * reported "100 of 111 source files" for a repository holding thousands.
   */
  it('measures the repository before the cap, not the sample it returns', () => {
    const entries = [
      ...Array.from({ length: 500 }, (_, index) => ({
        path: `apps/web/src/lib/mod-${index}.ts`,
        type: 'blob' as const,
      })),
      { path: 'apps/web/src/legacy.go', type: 'blob' as const },
      { path: 'tools/build.ts', type: 'blob' as const },
      { path: 'node_modules/react/index.js', type: 'blob' as const },
      { path: 'README.md', type: 'blob' as const },
    ];

    const selected = selectInstantGateTreeEntries(entries);

    expect(selected.tree).toHaveLength(INSTANT_GATE_MAX_FILES);
    expect(selected.totals).toEqual({
      sourceTotal: 502,
      surfaceSource: 501,
      surfaceAnalyzable: 500,
    });
  });

  it('flags the counts as a floor when GitHub truncated its own tree', () => {
    const selected = selectInstantGateTreeEntries(
      [{ path: 'apps/web/src/a.ts', type: 'blob' as const }],
      true,
    );
    expect(selected.totals.partial).toBe(true);
  });
});

describe('loadInstantGateTree', () => {
  afterEach(() => {
    clearInstantGateTreeCacheForTests();
    vi.unstubAllGlobals();
  });

  it('recurses only apps and supabase when the root listing has an apps directory', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes('/commits/')) {
        return new Response(JSON.stringify({ sha: 'a'.repeat(40) }), { status: 200 });
      }
      if (
        href.includes('/git/trees/') &&
        href.includes('recursive=1') &&
        href.includes('apps-sha')
      ) {
        return new Response(
          JSON.stringify({
            tree: [
              {
                path: 'web/src/app/page.tsx',
                type: 'blob',
                sha: 'file-sha',
                url: 'https://api.github.com/repos/acme/app/git/blobs/file-sha',
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (href.includes('/git/trees/') && href.includes('recursive=1') && href.includes('sb-sha')) {
        return new Response(
          JSON.stringify({ tree: [{ path: 'migrations/1.sql', type: 'blob' }] }),
          { status: 200 },
        );
      }
      if (href.includes('/git/trees/') && href.includes('recursive=1')) {
        throw new Error(`unexpected full recursive tree fetch: ${href}`);
      }
      if (href.includes('/git/trees/')) {
        return new Response(
          JSON.stringify({
            tree: [
              { path: 'apps', type: 'tree', sha: 'apps-sha' },
              { path: 'supabase', type: 'tree', sha: 'sb-sha' },
              { path: 'README.md', type: 'blob' },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response('missing', { status: 404 });
    });

    const result = await loadInstantGateTree({
      repo: 'acme/app',
      branch: 'main',
      headers: {},
      cacheKey: 'public:acme/app',
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.tree.map((entry) => entry.path).sort()).toEqual([
      'apps/web/src/app/page.tsx',
      'supabase/migrations/1.sql',
    ]);
    expect(result.tree[0] && 'url' in result.tree[0]).toBe(false);
    expect(result.commit_sha).toBe('a'.repeat(40));
  });

  it('skips GitHub tree fetches on a commit-sha cache hit', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes('/commits/')) {
        return new Response(JSON.stringify({ sha: 'b'.repeat(40) }), { status: 200 });
      }
      if (href.includes('/git/trees/') && href.includes('recursive=1')) {
        return new Response(JSON.stringify({ tree: [{ path: 'package.json', type: 'blob' }] }), {
          status: 200,
        });
      }
      if (href.includes('/git/trees/')) {
        return new Response(JSON.stringify({ tree: [{ path: 'package.json', type: 'blob' }] }), {
          status: 200,
        });
      }
      return new Response('missing', { status: 404 });
    });

    const first = await loadInstantGateTree({
      repo: 'acme/app',
      branch: 'main',
      headers: {},
      cacheKey: 'public:acme/app',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const treeFetchesAfterFirst = fetchImpl.mock.calls.filter((call) =>
      String(call[0]).includes('/git/trees/'),
    ).length;

    const second = await loadInstantGateTree({
      repo: 'acme/app',
      branch: 'main',
      headers: {},
      cacheKey: 'public:acme/app',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const treeFetchesAfterSecond = fetchImpl.mock.calls.filter((call) =>
      String(call[0]).includes('/git/trees/'),
    ).length;

    expect(second.tree).toEqual(first.tree);
    expect(treeFetchesAfterSecond).toBe(treeFetchesAfterFirst);
  });

  it('refetches the GitHub tree after the 60s cache TTL', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(Date.parse('2026-08-17T12:00:00.000Z'));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes('/commits/')) {
        return new Response(JSON.stringify({ sha: 'c'.repeat(40) }), { status: 200 });
      }
      if (href.includes('/git/trees/')) {
        return new Response(JSON.stringify({ tree: [{ path: 'package.json', type: 'blob' }] }), {
          status: 200,
        });
      }
      return new Response('missing', { status: 404 });
    });

    await loadInstantGateTree({
      repo: 'acme/app',
      branch: 'main',
      headers: {},
      cacheKey: 'public:acme/app',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const treeFetchesAfterFirst = fetchImpl.mock.calls.filter((call) =>
      String(call[0]).includes('/git/trees/'),
    ).length;

    now.mockReturnValue(Date.parse('2026-08-17T12:01:01.000Z'));
    try {
      await loadInstantGateTree({
        repo: 'acme/app',
        branch: 'main',
        headers: {},
        cacheKey: 'public:acme/app',
        fetchImpl: fetchImpl as typeof fetch,
      });
      const treeFetchesAfterExpiry = fetchImpl.mock.calls.filter((call) =>
        String(call[0]).includes('/git/trees/'),
      ).length;
      expect(treeFetchesAfterExpiry).toBeGreaterThan(treeFetchesAfterFirst);
    } finally {
      now.mockRestore();
    }
  });
});
