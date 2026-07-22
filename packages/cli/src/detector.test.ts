import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectStack } from './detector';

const tempDirs: string[] = [];

function makeTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assurly-detector-test-'));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath: string, contents: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(contents));
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('detectStack', () => {
  it('detects the stack from a flat single-package project (unchanged behaviour)', () => {
    const project = makeTempProject();
    writeJson(path.join(project, 'package.json'), {
      dependencies: { next: '^14.0.0', '@supabase/supabase-js': '^2.0.0', stripe: '^14.0.0' },
    });

    const stack = detectStack(project);

    expect(stack).toEqual({
      framework: 'nextjs',
      database: 'supabase',
      payments: 'stripe',
      deployment: 'vercel', // inferred from framework: nextjs
    });
  });

  it('merges workspace member package.json files when the root manifest is a bare workspace pointer', () => {
    const project = makeTempProject();
    // Mirrors this repo's own shape: root has no deps, real deps live in apps/web.
    writeJson(path.join(project, 'package.json'), {
      devDependencies: { prettier: '^3.0.0' },
      workspaces: ['apps/*', 'packages/*'],
    });
    writeJson(path.join(project, 'apps/web/package.json'), {
      dependencies: { next: '16.2.9', '@supabase/supabase-js': '^2.108.1', stripe: '^22.2.2' },
    });
    writeJson(path.join(project, 'packages/scanner-core/package.json'), {
      dependencies: { zod: '^3.0.0' },
    });

    const stack = detectStack(project);

    expect(stack.framework).toBe('nextjs');
    expect(stack.database).toBe('supabase');
    expect(stack.payments).toBe('stripe');
    expect(stack.deployment).toBe('vercel');
  });

  it('finds a vercel.json that lives next to a nested workspace member, not just the root', () => {
    const project = makeTempProject();
    writeJson(path.join(project, 'package.json'), { workspaces: ['apps/*'] });
    writeJson(path.join(project, 'apps/web/package.json'), { dependencies: {} });
    fs.writeFileSync(path.join(project, 'apps/web/vercel.json'), '{}');

    const stack = detectStack(project);

    expect(stack.deployment).toBe('vercel');
  });

  it('ignores package.json files under node_modules', () => {
    const project = makeTempProject();
    writeJson(path.join(project, 'package.json'), { workspaces: ['apps/*'] });
    writeJson(path.join(project, 'apps/web/package.json'), { dependencies: {} });
    writeJson(path.join(project, 'node_modules/next/package.json'), {
      dependencies: { next: '16.2.9' },
    });

    const stack = detectStack(project);

    expect(stack.framework).toBe('unknown');
  });

  it('returns all-unknown defaults when there is no package.json anywhere', () => {
    const project = makeTempProject();

    const stack = detectStack(project);

    expect(stack).toEqual({
      framework: 'unknown',
      database: 'none',
      payments: 'none',
      deployment: 'unknown',
    });
  });

  it('skips a malformed manifest instead of blanking out the rest of the workspace', () => {
    const project = makeTempProject();
    fs.mkdirSync(path.join(project, 'apps/broken'), { recursive: true });
    fs.writeFileSync(path.join(project, 'apps/broken/package.json'), '{ not valid json');
    writeJson(path.join(project, 'apps/web/package.json'), {
      dependencies: { next: '16.2.9' },
    });

    const stack = detectStack(project);

    expect(stack.framework).toBe('nextjs');
  });
});
