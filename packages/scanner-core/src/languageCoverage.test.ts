import { describe, expect, it } from 'vitest';
import {
  formatUnanalyzedLogLine,
  isAnalyzedCodeFile,
  isAnalyzedSourceFile,
  isSecuritySurfacePath,
  summarizeUnanalyzedSource,
  unanalyzedLanguageCounts,
  unanalyzedSourceFinding,
} from './languageCoverage';

const ATTESTA_GO_PATHS = [
  'internal/handler/http/stripe_handler.go',
  'internal/middleware/auth.go',
  'internal/repository/postgres_apikey.go',
  'cmd/server/main.go',
  'internal/domain/user.go',
];

describe('isAnalyzedSourceFile', () => {
  it('recognizes JS/TS/SQL and env files', () => {
    expect(isAnalyzedSourceFile('web/src/app/page.tsx')).toBe(true);
    expect(isAnalyzedSourceFile('src/index.mjs')).toBe(true);
    expect(isAnalyzedSourceFile('db/schema.sql')).toBe(true);
    expect(isAnalyzedSourceFile('.env.example')).toBe(true);
    expect(isAnalyzedSourceFile('apps/web/.env.local')).toBe(true);
  });

  it('does not treat other application languages as analysed', () => {
    expect(isAnalyzedSourceFile('internal/handler/http/stripe_handler.go')).toBe(false);
    expect(isAnalyzedSourceFile('app.py')).toBe(false);
    expect(isAnalyzedSourceFile('README.md')).toBe(false);
  });
});

describe('isAnalyzedCodeFile', () => {
  it('counts JS/TS/SQL including .mjs/.cjs and excludes env config', () => {
    expect(isAnalyzedCodeFile('web/next.config.mjs')).toBe(true);
    expect(isAnalyzedCodeFile('src/index.cjs')).toBe(true);
    expect(isAnalyzedCodeFile('db/schema.sql')).toBe(true);
    expect(isAnalyzedCodeFile('.env.example')).toBe(false);
    expect(isAnalyzedCodeFile('internal/handler/http/stripe_handler.go')).toBe(false);
  });
});

describe('isSecuritySurfacePath', () => {
  it('flags payment and auth paths', () => {
    expect(isSecuritySurfacePath('internal/handler/http/stripe_handler.go')).toBe(true);
    expect(isSecuritySurfacePath('internal/middleware/auth.go')).toBe(true);
    expect(isSecuritySurfacePath('internal/repository/postgres_apikey.go')).toBe(true);
  });

  it('leaves generic application files unmarked', () => {
    expect(isSecuritySurfacePath('cmd/server/main.go')).toBe(false);
    expect(isSecuritySurfacePath('internal/domain/user.go')).toBe(false);
  });
});

describe('summarizeUnanalyzedSource', () => {
  it('groups Attesta-like Go files and keeps security-surface examples', () => {
    const summary = summarizeUnanalyzedSource([
      ...ATTESTA_GO_PATHS,
      'web/src/app/page.tsx',
      'db/schema.sql',
    ]);

    expect(summary.totalFiles).toBe(5);
    expect(summary.languages).toEqual([
      {
        language: 'Go',
        fileCount: 5,
        securitySurfaceExamples: [
          'internal/handler/http/stripe_handler.go',
          'internal/middleware/auth.go',
        ],
      },
    ]);
    expect(unanalyzedLanguageCounts(summary)).toEqual([{ language: 'Go', fileCount: 5 }]);
  });

  it('ignores analysed source and documentation', () => {
    expect(
      summarizeUnanalyzedSource(['src/app.ts', 'README.md', 'go.mod', 'package.json']).totalFiles,
    ).toBe(0);
  });
});

describe('unanalyzedSourceFinding', () => {
  it('returns null when unread files are not on a security surface', () => {
    const summary = summarizeUnanalyzedSource(['cmd/hello.go', 'tools/fmt.go']);
    expect(unanalyzedSourceFinding(summary)).toBeNull();
    expect(formatUnanalyzedLogLine(summary)).toBe(
      '2 Go file(s) not analysed — Assurly rules cover JS/TS/SQL.',
    );
  });

  it('emits a warning when unread Go files include payment and auth code', () => {
    const finding = unanalyzedSourceFinding(summarizeUnanalyzedSource(ATTESTA_GO_PATHS));
    expect(finding).not.toBeNull();
    expect(finding?.ruleId).toBe('scan-language-coverage');
    expect(finding?.severity).toBe('warning');
    expect(finding?.confidence).toBe('high');
    expect(finding?.message).toMatch(/5 Go files were not analysed/);
    expect(finding?.message).toContain('internal/handler/http/stripe_handler.go');
    expect(finding?.message).toContain('internal/middleware/auth.go');
    expect(finding?.message).not.toMatch(/Anyone on the internet/i);
    expect(finding?.suggestion).toMatch(/Review the Go backend by hand/);
  });
});
