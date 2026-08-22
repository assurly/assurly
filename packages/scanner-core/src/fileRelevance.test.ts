import { describe, expect, it } from 'vitest';
import {
  INSTANT_GATE_MAX_FILES,
  buildScanScope,
  formatScanScopeSummary,
  getFileRelevanceScore,
  inferScanRoots,
  instantGateSurfaceFiles,
  isScannableFile,
  isTextScanSurface,
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
    expect(isScannableFile('coverage/lcov-report/index.html')).toBe(false);
    expect(isScannableFile('apps/web/src/testing/e2eDashboardFixture.ts')).toBe(false);
    expect(isScannableFile('src/__mocks__/stripe.ts')).toBe(false);
    expect(isScannableFile('playwright.config.ts')).toBe(false);
    expect(isScannableFile('apps/web/playwright.config.ts')).toBe(false);
  });

  // A fixture directory holds code written to fail every rule. Scanning it
  // reports those planted failures as real ones, which is how this repository
  // came to fail its own ship gate on `test-project/schema.sql`.
  it('excludes a fixture directory whether it is named singular or plural', () => {
    expect(isScannableFile('test-project/schema.sql')).toBe(false);
    expect(isScannableFile('test-projects/broken/schema.sql')).toBe(false);
    expect(isScannableFile('packages/cli/test-project/api.ts')).toBe(false);
    expect(isScannableFile('packages/cli/test-projects/x/api.ts')).toBe(false);
  });

  // The pattern must match a whole path segment. A real directory whose name
  // merely starts with those characters is production code.
  it('does not exclude paths that only begin with the fixture prefix', () => {
    expect(isScannableFile('test-projection/src/app.ts')).toBe(true);
    expect(isScannableFile('src/test-projectile.ts')).toBe(true);
  });

  it('includes production application paths', () => {
    expect(isScannableFile('apps/web/src/app/api/foo/route.ts')).toBe(true);
    expect(isScannableFile('apps/web/src/middleware.ts')).toBe(true);
    expect(isScannableFile('supabase/migrations/001.sql')).toBe(true);
  });
});

describe('isTextScanSurface', () => {
  it('keeps rule-readable text including .mjs, .toml, gitignore, and env examples', () => {
    expect(isTextScanSurface('eslint.config.mjs')).toBe(true);
    expect(isTextScanSurface('supabase/config.toml')).toBe(true);
    expect(isTextScanSurface('.gitignore')).toBe(true);
    expect(isTextScanSurface('apps/web/.env.example')).toBe(true);
    expect(isTextScanSurface('apps/web/.env.local')).toBe(true);
    expect(isTextScanSurface('src/app.ts')).toBe(true);
  });

  it('drops binaries and extensionless hooks that CLI listFiles still counts', () => {
    expect(isTextScanSurface('public/image.png')).toBe(false);
    expect(isTextScanSurface('public/mark.svg')).toBe(false);
    expect(isTextScanSurface('release.zip')).toBe(false);
    expect(isTextScanSurface('.husky/pre-commit')).toBe(false);
    expect(isTextScanSurface('LICENSE')).toBe(false);
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

  it('ranks Stripe billing helpers above generic utils so they survive the Instant Gate cap', () => {
    expect(getFileRelevanceScore('apps/web/src/utils/stripeBilling.ts')).toBeGreaterThan(
      getFileRelevanceScore('apps/web/src/utils/pluralize.ts'),
    );
  });
});

describe('buildScanScope', () => {
  function expectInvariant(scope: ReturnType<typeof buildScanScope>): void {
    expect(scope.sourceTotal).toBeDefined();
    expect(scope.gaps).toBeDefined();
    const gaps = scope.gaps!;
    expect(scope.scanned + gaps.notAnalysed + gaps.overLimit + gaps.outsideAppRoots).toBe(
      scope.sourceTotal,
    );
    expect(scope.skipped).toBe(gaps.notAnalysed + gaps.overLimit + gaps.outsideAppRoots);
  }

  it('counts skipped non-scannable files and cap overflow without a tree', () => {
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
    expect(scope.unanalyzed).toBeUndefined();
    expect(scope.sourceTotal).toBeUndefined();
  });

  it('uses a source-file denominator and names unread languages', () => {
    const selected = ['web/src/app/page.tsx', 'db/schema.sql'];
    const treePaths = [
      ...selected,
      'internal/handler/http/stripe_handler.go',
      'internal/middleware/auth.go',
      'README.md',
    ];
    const scope = buildScanScope(selected, selected, {
      treePaths,
      unanalyzed: [{ language: 'Go', fileCount: 2 }],
    });

    expectInvariant(scope);
    expect(scope.scanned).toBe(2);
    expect(scope.sourceTotal).toBe(4);
    expect(scope.gaps).toEqual({ notAnalysed: 2, overLimit: 0, outsideAppRoots: 0 });
    expect(scope.unanalyzed).toEqual([{ language: 'Go', fileCount: 2 }]);
    expect(formatScanScopeSummary(scope)).toBe(
      'Scanned repository · 2 of 4 source files · 2 Go files not analysed',
    );
  });

  it('matches an Attesta-shaped tree: Go plus Python, no tests in the fraction', () => {
    const selected = ['web/src/app/page.tsx', 'web/next.config.mjs', 'db/schema.sql'];
    const treePaths = [
      ...selected,
      ...Array.from({ length: 53 }, (_, index) => `internal/pkg_${index}.go`),
      'scripts/seed.py',
      'README.md',
      'Dockerfile',
      'docs/DEPLOY.md',
      'web/src/app.test.ts',
      'node_modules/react/index.js',
    ];
    const scope = buildScanScope(selected, selected, { treePaths, limit: INSTANT_GATE_MAX_FILES });

    expectInvariant(scope);
    expect(scope.scanned).toBe(3);
    expect(scope.sourceTotal).toBe(57);
    expect(scope.gaps).toEqual({ notAnalysed: 54, overLimit: 0, outsideAppRoots: 0 });
    expect(scope.unanalyzed).toEqual([
      { language: 'Go', fileCount: 53 },
      { language: 'Python', fileCount: 1 },
    ]);
    expect(formatScanScopeSummary(scope)).toBe(
      'Scanned repository · 3 of 57 source files · 53 Go and 1 Python file not analysed',
    );
  });

  it('names files dropped because they sit outside Instant Gate app roots', () => {
    const selected = ['apps/web/src/app/page.tsx'];
    const treePaths = [
      'apps/web/src/app/page.tsx',
      'packages/cli/src/index.ts',
      'packages/scanner-core/src/fileRelevance.ts',
    ];
    const scope = buildScanScope(selected, selected, { treePaths });

    expectInvariant(scope);
    expect(scope.scanned).toBe(1);
    expect(scope.sourceTotal).toBe(3);
    expect(scope.gaps).toEqual({ notAnalysed: 0, overLimit: 0, outsideAppRoots: 2 });
    expect(formatScanScopeSummary(scope)).toBe(
      'Scanned apps/web · 1 of 3 source files · 2 outside app roots',
    );
  });

  it('names Instant Gate cap overflow against the source denominator', () => {
    const selected = Array.from({ length: 2 }, (_, index) => `src/file-${index}.ts`);
    const treePaths = [
      ...Array.from({ length: 5 }, (_, index) => `src/file-${index}.ts`),
      ...Array.from({ length: 3 }, (_, index) => `compiler/src/file-${index}.rs`),
    ];
    const scope = buildScanScope(selected, selected, { treePaths, limit: 2 });

    expectInvariant(scope);
    expect(scope.scanned).toBe(2);
    expect(scope.sourceTotal).toBe(8);
    expect(scope.gaps).toEqual({ notAnalysed: 3, overLimit: 3, outsideAppRoots: 0 });
    expect(formatScanScopeSummary(scope)).toBe(
      'Scanned repository · 2 of 8 source files · 3 Rust files not analysed · 3 over the 2-file limit',
    );
  });

  it('does not let node_modules inflate the source denominator', () => {
    const selected = ['server.js'];
    const treePaths = [
      'server.js',
      'README.md',
      'package.json',
      'node_modules/express/index.js',
      'node_modules/body-parser/index.js',
    ];
    const scope = buildScanScope(selected, selected, { treePaths });

    expectInvariant(scope);
    expect(scope.scanned).toBe(1);
    expect(scope.sourceTotal).toBe(1);
    expect(scope.gaps).toEqual({ notAnalysed: 0, overLimit: 0, outsideAppRoots: 0 });
    expect(formatScanScopeSummary(scope)).toBe('Scanned repository · 1 of 1 source file');
  });

  it('falls back to a count-only sentence when sourceTotal is absent', () => {
    const scope = buildScanScope(['src/app.ts'], ['src/app.ts']);
    expect(formatScanScopeSummary(scope)).toBe('Scanned repository · 1 source file analysed');
  });
});

describe('instantGateSurfaceFiles', () => {
  it('drops packages from Instant Gate completeness when apps/ exists', () => {
    const files = [
      ...Array.from({ length: 200 }, (_, index) => `apps/web/src/file-${index}.ts`),
      ...Array.from({ length: 60 }, (_, index) => `packages/cli/src/file-${index}.ts`),
    ];
    const surface = instantGateSurfaceFiles(files, (path) => path);

    expect(surface).toHaveLength(200);
    expect(surface.every((path) => path.startsWith('apps/'))).toBe(true);
    expect(surface.length).toBeLessThanOrEqual(INSTANT_GATE_MAX_FILES);
  });

  it('keeps a 277-file apps/ surface complete under the Instant Gate cap', () => {
    const files = [
      ...Array.from({ length: 277 }, (_, index) => `apps/web/src/file-${index}.ts`),
      ...Array.from({ length: 60 }, (_, index) => `packages/cli/src/file-${index}.ts`),
    ];
    const surface = instantGateSurfaceFiles(files, (path) => path);
    expect(surface).toHaveLength(277);
    expect(surface.length).toBeLessThanOrEqual(INSTANT_GATE_MAX_FILES);
  });

  it('keeps packages when the repository has no apps/ tree', () => {
    const files = ['packages/api/src/route.ts', 'src/index.ts'];
    expect(instantGateSurfaceFiles(files, (path) => path)).toEqual(files);
  });

  it('includes supabase/ alongside apps/ on the Instant Gate surface', () => {
    const files = [
      'apps/web/src/app/page.tsx',
      'supabase/migrations/001.sql',
      'packages/scanner-core/src/index.ts',
    ];
    expect(instantGateSurfaceFiles(files, (path) => path)).toEqual([
      'apps/web/src/app/page.tsx',
      'supabase/migrations/001.sql',
    ]);
  });
});
