import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { githubHeaders, githubRepositoryApiUrl } from './githubApp';

/**
 * Limits for unpacking a repository snapshot inside a serverless function. A
 * Full Gate scan reads source and config; it needs neither large binaries nor
 * vendored dependencies, and an archive past these limits is refused rather
 * than half-read into a verdict.
 */
export const TARBALL_LIMITS = {
  /** Compressed archive as downloaded. */
  maxArchiveBytes: 60 * 1024 * 1024,
  /** Archive after gunzip. */
  maxUnpackedBytes: 250 * 1024 * 1024,
  /** Any single file larger than this is skipped, not written. */
  maxFileBytes: 1024 * 1024,
  maxFiles: 20_000,
} as const;

export class TarballTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TarballTooLargeError';
  }
}

export interface TarballEntry {
  /** Path inside the repository, without GitHub's `owner-repo-sha/` root. */
  path: string;
  content: Buffer;
}

export interface ExtractResult {
  written: number;
  skipped: number;
}

const BLOCK = 512;
// The same build and dependency output the scanner's isScannableFile ignores.
const SKIPPED_DIRECTORIES = /(^|\/)(node_modules|\.git|\.next|dist|coverage)\//;

function readString(block: Buffer, start: number, length: number): string {
  const raw = block.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
}

function readOctal(block: Buffer, start: number, length: number): number {
  const text = readString(block, start, length).trim();
  return text ? parseInt(text, 8) : 0;
}

/** `path=` from a pax extended header, which carries names longer than 100 bytes. */
function paxPath(content: Buffer): string | null {
  let offset = 0;
  const text = content.toString('utf8');
  while (offset < text.length) {
    const space = text.indexOf(' ', offset);
    if (space === -1) break;
    const length = Number(text.slice(offset, space));
    if (!Number.isFinite(length) || length <= 0) break;
    const record = text.slice(space + 1, offset + length - 1);
    const equals = record.indexOf('=');
    if (equals !== -1 && record.slice(0, equals) === 'path') return record.slice(equals + 1);
    offset += length;
  }
  return null;
}

/** Drops GitHub's single root directory and rejects anything that escapes it. */
export function repositoryRelativePath(archivePath: string): string | null {
  const parts = archivePath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const inner = parts.slice(1);
  if (inner.some((part) => part === '..' || part === '.')) return null;
  return inner.join('/');
}

/**
 * Regular files of a gzipped ustar/pax archive. Symlinks, hard links and
 * device entries are never returned: a scan must not follow a link out of the
 * snapshot. Throws `TarballTooLargeError` past the unpacked size limit.
 */
export function readTarGz(archive: Buffer, limits = TARBALL_LIMITS): TarballEntry[] {
  let tar: Buffer;
  try {
    tar = gunzipSync(archive, { maxOutputLength: limits.maxUnpackedBytes });
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new TarballTooLargeError('Repository snapshot is larger than the Full Gate limit.');
    }
    throw error;
  }

  const entries: TarballEntry[] = [];
  let pendingPath: string | null = null;
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;

    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const dataStart = offset + BLOCK;
    const content = tar.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'x') {
      pendingPath = paxPath(content);
      continue;
    }
    if (type === 'L') {
      pendingPath = content.toString('utf8').replace(/\0+$/, '');
      continue;
    }
    if (type === 'g') continue;

    const prefix = readString(header, 345, 155);
    const name = readString(header, 0, 100);
    const archivePath = pendingPath ?? (prefix ? `${prefix}/${name}` : name);
    pendingPath = null;

    if (type !== '0' && type !== '\0') continue;
    const relative = repositoryRelativePath(archivePath);
    if (!relative || SKIPPED_DIRECTORIES.test(relative)) continue;
    if (size > limits.maxFileBytes) continue;
    entries.push({ path: relative, content: Buffer.from(content) });
    if (entries.length > limits.maxFiles) {
      throw new TarballTooLargeError(
        'Repository snapshot has more files than the Full Gate limit.',
      );
    }
  }
  return entries;
}

/** Writes entries under `destination`, refusing any path that resolves outside it. */
export async function writeEntries(
  entries: readonly TarballEntry[],
  destination: string,
): Promise<ExtractResult> {
  const root = path.resolve(destination);
  let written = 0;
  let skipped = 0;
  for (const entry of entries) {
    const target = path.resolve(root, entry.path);
    if (!target.startsWith(`${root}${path.sep}`)) {
      skipped += 1;
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entry.content);
    written += 1;
  }
  return { written, skipped };
}

/**
 * Downloads one commit of a repository as GitHub's tarball, with the
 * installation token. The body is read with a hard byte cap so an oversized
 * archive is refused instead of exhausting the function's memory.
 */
export async function downloadCommitTarball(
  repositoryName: string,
  commitSha: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
  limits = TARBALL_LIMITS,
): Promise<Buffer> {
  const response = await fetchImpl(githubRepositoryApiUrl(repositoryName, 'tarball', commitSha), {
    headers: githubHeaders(token),
    redirect: 'follow',
  });
  if (!response.ok || !response.body) {
    throw new Error(`Repository snapshot download failed with HTTP ${response.status}.`);
  }
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > limits.maxArchiveBytes) {
    throw new TarballTooLargeError('Repository snapshot is larger than the Full Gate limit.');
  }

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limits.maxArchiveBytes) {
      await reader.cancel();
      throw new TarballTooLargeError('Repository snapshot is larger than the Full Gate limit.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
