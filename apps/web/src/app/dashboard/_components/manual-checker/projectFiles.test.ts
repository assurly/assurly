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

  it('rejects archive traversal paths', async () => {
    const archive = await zipFile({ '../secret.ts': 'export const secret = true;' });
    await expect(readZipFile(archive)).rejects.toThrow('unsafe path');
  });
});
