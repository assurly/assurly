import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { readFileListFromInput, readZipFile } from './projectFiles';

function snapshotSelectedFiles(files: File[]): File[] {
  return Array.from(files);
}

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
      { path: 'my-project/db/schema.sql', content: 'create table users (id uuid);' },
    ]);
  });

  it('reads files from a snapshot taken before clearing the input', async () => {
    const file = new File(['export const ok = true;'], 'app.ts', { type: 'text/plain' });
    Object.defineProperty(file, 'webkitRelativePath', {
      value: 'snapshot/src/app.ts',
    });

    const result = await readFileListFromInput(snapshotSelectedFiles([file]));
    expect(result.rootFolderName).toBe('snapshot');
    expect(result.files).toEqual([
      { path: 'snapshot/src/app.ts', content: 'export const ok = true;' },
    ]);
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
      { path: 'shipready/apps/web/src/app/api/route.ts', content: 'export const ok = true;' },
    ]);
  });
});
