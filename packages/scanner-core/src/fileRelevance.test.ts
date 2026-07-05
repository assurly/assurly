import { describe, expect, it } from 'vitest';
import {
  buildScanScope,
  getFileRelevanceScore,
  inferScanRoots,
  isScannableFile,
  rankFilesByRelevance,
} from './fileRelevance';

describe('isScannableFile', () => {
  it('excludes tests, fixtures, vendor, and build output', () => {
    expect(isScannableFile('src/utils.test.ts')).toBe(false);
    expect(isScannableFile('src/utils.spec.tsx')).toBe(false);
    expect(isScannableFile('test-projects/x/y.sql')).toBe(false);
    expect(isScannableFile('vendor/lib/index.js')).toBe(false);
    expect(isScannableFile('dist/server.js')).toBe(false);
    expect(isScannableFile('.next/server/pages.js')).toBe(false);
    expect(isScannableFile('node_modules/react/index.js')).toBe(false);
    expect(isScannableFile('src/__tests__/helpers.ts')).toBe(false);
    expect(isScannableFile('data/fixtures/seed.sql')).toBe(false);
  });

  it('includes production application paths', () => {
    expect(isScannableFile('apps/web/src/app/api/foo/route.ts')).toBe(true);
    expect(isScannableFile('apps/web/src/middleware.ts')).toBe(true);
    expect(isScannableFile('supabase/migrations/001.sql')).toBe(true);
  });
});

describe('rankFilesByRelevance', () => {
  it('prioritizes app, api, supabase, and db paths over alphabetical tail', () => {
    const files = Array.from({ length: 1000 }, (_, index) => `zzz/noise/file-${index}.ts`);
    files.push(
      'apps/web/src/app/page.tsx',
      'apps/web/src/app/api/users/route.ts',
      'supabase/migrations/schema.sql',
      'packages/db/client.ts',
    );

    const ranked = rankFilesByRelevance(files, (path) => path);
    const topFour = ranked.slice(0, 4);

    expect(topFour).toContain('apps/web/src/app/api/users/route.ts');
    expect(topFour).toContain('apps/web/src/app/page.tsx');
    expect(topFour).toContain('supabase/migrations/schema.sql');
    expect(topFour).toContain('packages/db/client.ts');
    expect(ranked.indexOf('apps/web/src/app/api/users/route.ts')).toBeLessThan(
      ranked.indexOf('zzz/noise/file-0.ts'),
    );
  });

  it('preserves stable ordering among equal scores', () => {
    const files = ['b.ts', 'a.ts', 'c.ts'];
    expect(rankFilesByRelevance(files, (path) => path)).toEqual(['b.ts', 'a.ts', 'c.ts']);
  });

  it('ranks route and middleware paths above generic files', () => {
    expect(getFileRelevanceScore('src/lib/util.ts')).toBe(0);
    expect(getFileRelevanceScore('src/middleware.ts')).toBeGreaterThan(0);
    expect(getFileRelevanceScore('src/app/api/route.ts')).toBeGreaterThan(
      getFileRelevanceScore('src/lib/util.ts'),
    );
  });
});

describe('buildScanScope', () => {
  it('counts skipped non-scannable files and cap overflow', () => {
    const candidates = [
      'apps/web/src/app/page.tsx',
      'apps/web/src/app.test.ts',
      'vendor/lib.js',
      'apps/web/src/lib/a.ts',
    ];
    const selected = ['apps/web/src/app/page.tsx', 'apps/web/src/lib/a.ts'];
    const scope = buildScanScope(candidates, selected);

    expect(scope.scanned).toBe(2);
    expect(scope.skipped).toBe(2);
    expect(inferScanRoots(selected)).toEqual(['apps/web']);
    expect(scope.roots).toEqual(['apps/web']);
  });
});
