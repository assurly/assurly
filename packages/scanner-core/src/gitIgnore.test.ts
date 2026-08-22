import { describe, expect, it } from 'vitest';
import {
  excludeGitIgnoredFiles,
  isAssurlyEnvExamplePath,
  isGitIgnorePath,
  isGitIgnored,
  parseGitIgnoreSources,
} from './gitIgnore';

const ROOT_IGNORE = [
  '.env',
  '.env.local',
  '.env.development.local',
  '.env.test.local',
  '.env.production.local',
  '.vscode/*',
  '!.vscode/extensions.json',
  '!.vscode/launch.json',
  '!.vscode/settings.json',
].join('\n');

/** Built at runtime so GitHub secret scanning does not reject the upload. */
const FAKE_STRIPE_TEST_KEY = `sk_${'test'}_${'abcdefghijklmnopqrstuvwx'}`;

describe('isGitIgnorePath', () => {
  it('matches root and nested gitignore files', () => {
    expect(isGitIgnorePath('.gitignore')).toBe(true);
    expect(isGitIgnorePath('apps/web/.gitignore')).toBe(true);
    expect(isGitIgnorePath('src/app.ts')).toBe(false);
  });
});

describe('isAssurlyEnvExamplePath', () => {
  it('matches .env.example at any depth', () => {
    expect(isAssurlyEnvExamplePath('.env.example')).toBe(true);
    expect(isAssurlyEnvExamplePath('apps/web/.env.example')).toBe(true);
    expect(isAssurlyEnvExamplePath('apps/web/.env.local')).toBe(false);
    expect(isAssurlyEnvExamplePath('apps/web/.env')).toBe(false);
  });
});

describe('isGitIgnored', () => {
  const sources = parseGitIgnoreSources([{ file: '.gitignore', content: ROOT_IGNORE }]);

  it('ignores .env.local at any depth after folder-prefix strip', () => {
    expect(isGitIgnored('apps/web/.env.local', sources)).toBe(true);
    expect(isGitIgnored('.env.local', sources)).toBe(true);
    expect(isGitIgnored('.env', sources)).toBe(true);
  });

  it('does not ignore committed .env.example', () => {
    expect(isGitIgnored('apps/web/.env.example', sources)).toBe(false);
    expect(isGitIgnored('.env.example', sources)).toBe(false);
  });

  it('honors negation for selected .vscode files', () => {
    expect(isGitIgnored('.vscode/settings.json', sources)).toBe(false);
    expect(isGitIgnored('.vscode/extensions.json', sources)).toBe(false);
    expect(isGitIgnored('.vscode/launch.json', sources)).toBe(false);
    expect(isGitIgnored('.vscode/tasks.json', sources)).toBe(true);
  });

  it('never ignores the .gitignore file itself', () => {
    expect(isGitIgnored('.gitignore', sources)).toBe(false);
    expect(isGitIgnored('apps/web/.gitignore', sources)).toBe(false);
  });

  it('applies nested gitignore relative to its directory', () => {
    const nested = parseGitIgnoreSources([
      { file: '.gitignore', content: ROOT_IGNORE },
      { file: 'apps/web/.gitignore', content: 'secret.ts\n' },
    ]);
    expect(isGitIgnored('apps/web/secret.ts', nested)).toBe(true);
    expect(isGitIgnored('apps/cli/secret.ts', nested)).toBe(false);
    expect(isGitIgnored('apps/web/.env.local', nested)).toBe(true);
  });

  it('lets a nested negation un-ignore a parent rule', () => {
    const nested = parseGitIgnoreSources([
      { file: '.gitignore', content: '*.log\n' },
      { file: 'apps/web/.gitignore', content: '!keep.log\n' },
    ]);
    expect(isGitIgnored('apps/web/debug.log', nested)).toBe(true);
    expect(isGitIgnored('apps/web/keep.log', nested)).toBe(false);
  });

  it('keeps .env.example when a nested Next.js .env* rule would hide it', () => {
    const nested = parseGitIgnoreSources([
      { file: '.gitignore', content: ROOT_IGNORE },
      { file: 'apps/web/.gitignore', content: '.env*\n' },
    ]);
    expect(isGitIgnored('apps/web/.env.example', nested)).toBe(false);
    expect(isGitIgnored('apps/web/.env.local', nested)).toBe(true);
    expect(isGitIgnored('apps/web/.env', nested)).toBe(true);
    expect(isGitIgnored('apps/web/.env.production', nested)).toBe(true);
  });
});

describe('excludeGitIgnoredFiles', () => {
  it('drops ignored env files and keeps .gitignore plus examples', () => {
    const kept = excludeGitIgnoredFiles([
      { file: '.gitignore', content: ROOT_IGNORE },
      {
        file: 'apps/web/.env.local',
        content: `STRIPE_SECRET_KEY=${FAKE_STRIPE_TEST_KEY}\n`,
      },
      { file: 'apps/web/.env.example', content: 'STRIPE_SECRET_KEY=\n' },
      { file: 'src/app.ts', content: 'export const ok = true;\n' },
    ]);
    expect(kept.map((file) => file.file).sort()).toEqual([
      '.gitignore',
      'apps/web/.env.example',
      'src/app.ts',
    ]);
  });

  it('is a no-op when no .gitignore is present', () => {
    const files = [{ file: 'apps/web/.env.local', content: 'SECRET=1\n' }];
    expect(excludeGitIgnoredFiles(files)).toEqual(files);
  });

  it('keeps nested .env.example when apps/web/.gitignore uses .env*', () => {
    const kept = excludeGitIgnoredFiles([
      { file: '.gitignore', content: ROOT_IGNORE },
      { file: 'apps/web/.gitignore', content: '.env*\n' },
      {
        file: 'apps/web/.env.local',
        content: `STRIPE_SECRET_KEY=${FAKE_STRIPE_TEST_KEY}\n`,
      },
      { file: 'apps/web/.env.example', content: 'STRIPE_SECRET_KEY=\n' },
      { file: 'src/app.ts', content: 'export const ok = true;\n' },
    ]);
    expect(kept.map((file) => file.file).sort()).toEqual([
      '.gitignore',
      'apps/web/.env.example',
      'apps/web/.gitignore',
      'src/app.ts',
    ]);
  });
});
