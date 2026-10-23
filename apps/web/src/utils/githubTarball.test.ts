import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadCommitTarball,
  readTarGz,
  repositoryRelativePath,
  TARBALL_LIMITS,
  TarballTooLargeError,
  writeEntries,
} from './githubTarball';
import { tarGz } from './tarGzTestFixture';

const ROOT = 'tibco87-assurly-live-target-f4ecb71';

describe('readTarGz', () => {
  it('returns repository files without GitHub’s root directory', () => {
    const entries = readTarGz(
      tarGz([
        { name: `${ROOT}/`, type: '5' },
        { name: `${ROOT}/package.json`, content: '{"name":"live-target"}' },
        { name: `${ROOT}/supabase/migrations/0001_customers.sql`, content: 'create table x();' },
      ]),
    );
    expect(entries.map((entry) => entry.path)).toEqual([
      'package.json',
      'supabase/migrations/0001_customers.sql',
    ]);
    expect(entries[0].content.toString()).toBe('{"name":"live-target"}');
  });

  it('reads names longer than 100 bytes from pax headers', () => {
    const deep = `${ROOT}/app/${'nested/'.repeat(14)}route.ts`;
    const [entry] = readTarGz(tarGz([{ name: deep, content: 'export {}' }]));
    expect(entry.path).toBe(deep.slice(ROOT.length + 1));
  });

  it('never returns a symlink or hard link, so a scan cannot follow one out', () => {
    const entries = readTarGz(
      tarGz([
        { name: `${ROOT}/leak`, type: '2', linkname: '/etc/passwd' },
        { name: `${ROOT}/hard`, type: '1', linkname: `${ROOT}/package.json` },
        { name: `${ROOT}/ok.ts`, content: 'export {}' },
      ]),
    );
    expect(entries.map((entry) => entry.path)).toEqual(['ok.ts']);
  });

  it('drops dependencies, build output and oversized files', () => {
    const entries = readTarGz(
      tarGz([
        { name: `${ROOT}/node_modules/left-pad/index.js`, content: 'x' },
        { name: `${ROOT}/.next/server/app.js`, content: 'x' },
        { name: `${ROOT}/public/video.mp4`, content: 'v'.repeat(2048) },
        { name: `${ROOT}/app/page.tsx`, content: 'x' },
      ]),
      { ...TARBALL_LIMITS, maxFileBytes: 1024 },
    );
    expect(entries.map((entry) => entry.path)).toEqual(['app/page.tsx']);
  });

  it('refuses an archive that unpacks past the limit', () => {
    const archive = tarGz([{ name: `${ROOT}/big.txt`, content: 'a'.repeat(4096) }]);
    expect(() => readTarGz(archive, { ...TARBALL_LIMITS, maxUnpackedBytes: 1024 })).toThrow(
      TarballTooLargeError,
    );
  });
});

describe('repositoryRelativePath', () => {
  it('rejects traversal and root-only entries', () => {
    expect(repositoryRelativePath(`${ROOT}/../../etc/passwd`)).toBeNull();
    expect(repositoryRelativePath(`${ROOT}/./a`)).toBeNull();
    expect(repositoryRelativePath(`${ROOT}/`)).toBeNull();
    expect(repositoryRelativePath(`${ROOT}/src/a.ts`)).toBe('src/a.ts');
  });
});

describe('writeEntries', () => {
  let directory: string | null = null;

  afterEach(async () => {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    directory = null;
  });

  it('writes inside the destination and refuses anything that resolves outside it', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'assurly-tarball-test-'));
    const result = await writeEntries(
      [
        { path: 'src/app.ts', content: Buffer.from('export {}') },
        { path: '../escape.ts', content: Buffer.from('no') },
      ],
      directory,
    );
    expect(result).toEqual({ written: 1, skipped: 1 });
    expect(await fs.readFile(path.join(directory, 'src/app.ts'), 'utf8')).toBe('export {}');
    await expect(fs.access(path.join(directory, '..', 'escape.ts'))).rejects.toThrow();
  });
});

describe('downloadCommitTarball', () => {
  it('asks GitHub for that exact commit with the installation token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.from('tar')));
    await downloadCommitTarball('tibco87/app', 'a'.repeat(40), 'install-token', fetchMock);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://api.github.com/repos/tibco87/app/tarball/${'a'.repeat(40)}`,
    );
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer install-token');
  });

  it('stops reading once the archive passes the size cap', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.alloc(4096)));
    await expect(
      downloadCommitTarball('tibco87/app', 'a'.repeat(40), 'token', fetchMock, {
        ...TARBALL_LIMITS,
        maxArchiveBytes: 1024,
      }),
    ).rejects.toThrow(TarballTooLargeError);
  });

  it('surfaces a failed download', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 404 }));
    await expect(
      downloadCommitTarball('tibco87/app', 'a'.repeat(40), 'token', fetchMock),
    ).rejects.toThrow('HTTP 404');
  });
});
