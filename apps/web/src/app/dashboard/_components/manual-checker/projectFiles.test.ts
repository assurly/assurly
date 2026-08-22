import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { readFileListFromInput, readZipFile } from './projectFiles';

function snapshotSelectedFiles(files: File[]): File[] {
  return Array.from(files);
}

/** Built at runtime so GitHub secret scanning does not reject the upload. */
const FAKE_STRIPE_TEST_ENV = `STRIPE_SECRET_KEY=sk_${'test'}_${'abcdefghijklmnopqrstuvwx'}\n`;

async function zipFile(entries: Record<string, string>): Promise<File> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) zip.file(path, content);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return new File([Uint8Array.from(bytes).buffer], 'project.zip', { type: 'application/zip' });
}

describe('readFileListFromInput', () => {
  it('reads supported files from a native directory selection', async () => {
    const file = new File(['create table users (id uuid);'], 'schema.sql', { type: 'text/plain' });
    Object.defineProperty(file, 'webkitRelativePath', {
      value: 'my-project/db/schema.sql',
    });

    const result = await readFileListFromInput([file]);
    expect(result.rootFolderName).toBe('my-project');
    expect(result.files).toEqual([
      { path: 'db/schema.sql', content: 'create table users (id uuid);' },
    ]);
  });

  it('reads files from a snapshot taken before clearing the input', async () => {
    const file = new File(['export const ok = true;'], 'app.ts', { type: 'text/plain' });
    Object.defineProperty(file, 'webkitRelativePath', {
      value: 'snapshot/src/app.ts',
    });

    const result = await readFileListFromInput(snapshotSelectedFiles([file]));
    expect(result.rootFolderName).toBe('snapshot');
    expect(result.files).toEqual([{ path: 'src/app.ts', content: 'export const ok = true;' }]);
  });
});

describe('readZipFile', () => {
  it('keeps supported source files and excludes dependency trees', async () => {
    const files = await readZipFile(
      await zipFile({
        'src/app.ts': 'export const app = true;',
        'node_modules/pkg/index.js': 'malicious()',
        'public/image.png': 'binary',
      }),
    );
    expect(files).toEqual([{ path: 'src/app.ts', content: 'export const app = true;' }]);
  });

  it('excludes tests, fixtures, and intentional broken sample apps', async () => {
    const files = await readZipFile(
      await zipFile({
        'apps/web/src/app.ts': 'export const app = true;',
        'apps/web/src/app.test.ts': 'export const test = true;',
        'test-projects/broken/schema.sql': 'create table users (id uuid);',
        'data/fixtures/seed.sql': 'create table posts (id uuid);',
        'vendor/lib.js': 'export default 1;',
        'src/testing/e2eFixture.ts': 'export const fixture = true;',
        'test-projection/src/app.ts': 'export const kept = true;',
      }),
    );
    const paths = files.map((file) => file.path).sort();
    expect(paths).toEqual(['apps/web/src/app.ts', 'test-projection/src/app.ts']);
  });

  it('strips a wrapping ZIP root folder so paths match a folder picker', async () => {
    const files = await readZipFile(
      await zipFile({
        'shipready/apps/web/src/app.ts': 'export const app = true;',
        'shipready/package.json': '{"name":"shipready"}',
      }),
    );
    const paths = files.map((file) => file.path).sort();
    expect(paths).toEqual(['apps/web/src/app.ts', 'package.json']);
  });

  it('keeps YAML workflows and markdown instruction files', async () => {
    const files = await readZipFile(
      await zipFile({
        '.github/workflows/ci.yml': 'name: ci\n',
        'CLAUDE.md': '# Agent\n',
        '.npmrc': 'ignore-scripts=true\n',
      }),
    );
    const paths = files.map((file) => file.path).sort();
    expect(paths).toEqual(['.github/workflows/ci.yml', '.npmrc', 'CLAUDE.md']);
  });

  it('rejects archive traversal paths', async () => {
    const archive = await zipFile({ '../secret.ts': 'export const secret = true;' });
    await expect(readZipFile(archive)).rejects.toThrow('unsafe path');
  });
});

describe('readFileListFromInput noise filter', () => {
  it('does not load unit tests or fixture directories from a folder selection', async () => {
    const keep = new File(['export const ok = true;'], 'route.ts', { type: 'text/plain' });
    Object.defineProperty(keep, 'webkitRelativePath', {
      value: 'shipready/apps/web/src/app/api/route.ts',
    });
    const testFile = new File(['export const t = true;'], 'route.test.ts', { type: 'text/plain' });
    Object.defineProperty(testFile, 'webkitRelativePath', {
      value: 'shipready/apps/web/src/app/api/route.test.ts',
    });
    const fixture = new File(['create table users (id uuid);'], 'init.sql', { type: 'text/plain' });
    Object.defineProperty(fixture, 'webkitRelativePath', {
      value: 'shipready/test-projects/broken-project/supabase/migrations/init.sql',
    });

    const result = await readFileListFromInput([keep, testFile, fixture]);
    expect(result.files).toEqual([
      { path: 'apps/web/src/app/api/route.ts', content: 'export const ok = true;' },
    ]);
  });

  it('does not load gitignored .env.local from a folder selection', async () => {
    const gitignore = new File(['.env\n.env.local\n'], '.gitignore', { type: 'text/plain' });
    Object.defineProperty(gitignore, 'webkitRelativePath', {
      value: 'shipready/.gitignore',
    });
    const localEnv = new File([FAKE_STRIPE_TEST_ENV], '.env.local', { type: 'text/plain' });
    Object.defineProperty(localEnv, 'webkitRelativePath', {
      value: 'shipready/apps/web/.env.local',
    });
    const example = new File(['STRIPE_SECRET_KEY=\n'], '.env.example', { type: 'text/plain' });
    Object.defineProperty(example, 'webkitRelativePath', {
      value: 'shipready/apps/web/.env.example',
    });

    const result = await readFileListFromInput([gitignore, localEnv, example]);
    const paths = result.files.map((file) => file.path).sort();
    expect(paths).toEqual(['.gitignore', 'apps/web/.env.example']);
  });

  it('keeps .env.example when nested Next.js gitignore uses .env*', async () => {
    const rootIgnore = new File(['.env\n.env.local\n'], '.gitignore', { type: 'text/plain' });
    Object.defineProperty(rootIgnore, 'webkitRelativePath', {
      value: 'shipready/.gitignore',
    });
    const webIgnore = new File(['.env*\n'], '.gitignore', { type: 'text/plain' });
    Object.defineProperty(webIgnore, 'webkitRelativePath', {
      value: 'shipready/apps/web/.gitignore',
    });
    const localEnv = new File([FAKE_STRIPE_TEST_ENV], '.env.local', { type: 'text/plain' });
    Object.defineProperty(localEnv, 'webkitRelativePath', {
      value: 'shipready/apps/web/.env.local',
    });
    const example = new File(['STRIPE_SECRET_KEY=\n'], '.env.example', { type: 'text/plain' });
    Object.defineProperty(example, 'webkitRelativePath', {
      value: 'shipready/apps/web/.env.example',
    });

    const result = await readFileListFromInput([rootIgnore, webIgnore, localEnv, example]);
    const paths = result.files.map((file) => file.path).sort();
    expect(paths).toEqual(['.gitignore', 'apps/web/.env.example', 'apps/web/.gitignore']);
  });

  it('loads .mjs and .toml from a folder selection and skips png', async () => {
    const mjs = new File(['export default [];\n'], 'eslint.config.mjs', { type: 'text/plain' });
    Object.defineProperty(mjs, 'webkitRelativePath', {
      value: 'shipready/eslint.config.mjs',
    });
    const toml = new File(['[api]\nenabled = true\n'], 'config.toml', { type: 'text/plain' });
    Object.defineProperty(toml, 'webkitRelativePath', {
      value: 'shipready/supabase/config.toml',
    });
    const png = new File(['binary'], 'mark.png', { type: 'image/png' });
    Object.defineProperty(png, 'webkitRelativePath', {
      value: 'shipready/public/mark.png',
    });

    const result = await readFileListFromInput([mjs, toml, png]);
    const paths = result.files.map((file) => file.path).sort();
    expect(paths).toEqual(['eslint.config.mjs', 'supabase/config.toml']);
  });
});

describe('readZipFile gitignore', () => {
  it('drops gitignored .env.local after stripping a wrapping root folder', async () => {
    const files = await readZipFile(
      await zipFile({
        'shipready/.gitignore': '.env\n.env.local\n',
        'shipready/apps/web/.env.local': FAKE_STRIPE_TEST_ENV,
        'shipready/apps/web/.env.example': 'STRIPE_SECRET_KEY=\n',
      }),
    );
    const paths = files.map((file) => file.path).sort();
    expect(paths).toEqual(['.gitignore', 'apps/web/.env.example']);
  });

  it('keeps .env.example when nested Next.js gitignore uses .env*', async () => {
    const files = await readZipFile(
      await zipFile({
        'shipready/.gitignore': '.env\n.env.local\n',
        'shipready/apps/web/.gitignore': '.env*\n',
        'shipready/apps/web/.env.local': FAKE_STRIPE_TEST_ENV,
        'shipready/apps/web/.env.example': 'STRIPE_SECRET_KEY=\n',
      }),
    );
    const paths = files.map((file) => file.path).sort();
    expect(paths).toEqual(['.gitignore', 'apps/web/.env.example', 'apps/web/.gitignore']);
  });
});

describe('readZipFile text surface', () => {
  it('loads .mjs and .toml while dropping png and gitignored .env.local', async () => {
    const files = await readZipFile(
      await zipFile({
        'shipready/.gitignore': '.env\n.env.local\n',
        'shipready/eslint.config.mjs': 'export default [];\n',
        'shipready/supabase/config.toml': '[api]\nenabled = true\n',
        'shipready/public/mark.png': 'binary',
        'shipready/apps/web/.env.local': FAKE_STRIPE_TEST_ENV,
      }),
    );
    const paths = files.map((file) => file.path).sort();
    expect(paths).toEqual(['.gitignore', 'eslint.config.mjs', 'supabase/config.toml']);
  });
});
