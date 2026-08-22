import JSZip from 'jszip';
import {
  isGitIgnorePath,
  isGitIgnored,
  isScannableFile,
  isTextScanSurface,
  parseGitIgnoreSources,
  type GitIgnoreFileInput,
} from '../../../../utils/browserScanner';
import type { ProjectFile } from './useManualScan';

/** Directory segment early-out before reading (I/O). Keep in sync with isScannableFile noise paths. */
const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  'vendor',
  'fixtures',
  '__tests__',
  '__mocks__',
  'test-project',
  'test-projects',
  'testing',
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PROJECT_FILES = 1_000;
const MAX_PROJECT_BYTES = 20 * 1024 * 1024;

export interface FileSystemEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

interface FileSystemFileEntry extends FileSystemEntry {
  file(callback: (file: File) => void, errorCallback?: (error: DOMException) => void): void;
}

interface FileSystemDirectoryEntry extends FileSystemEntry {
  createReader(): FileSystemDirectoryReader;
}

interface FileSystemDirectoryReader {
  readEntries(
    callback: (entries: FileSystemEntry[]) => void,
    errorCallback?: (error: DOMException) => void,
  ): void;
}

interface FileSystemHandle {
  readonly kind: 'file' | 'directory';
  readonly name: string;
}
interface FileSystemFileHandle extends FileSystemHandle {
  readonly kind: 'file';
  getFile(): Promise<File>;
}

export interface FileSystemDirectoryHandle extends FileSystemHandle {
  readonly kind: 'directory';
  values(): AsyncIterableIterator<FileSystemHandle>;
}

export interface DirectoryPickerWindow extends Window {
  showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
}

interface PathCandidate {
  path: string;
  size: number;
  read: () => Promise<string>;
}

function allowedPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  const segments = normalized.split('/');
  return (
    !segments.some((segment) => EXCLUDED_DIRECTORIES.has(segment)) &&
    isScannableFile(normalized) &&
    isTextScanSurface(normalized)
  );
}

function isLoadablePath(path: string): boolean {
  return isGitIgnorePath(path) || allowedPath(path);
}

const PROJECT_ROOT_SEGMENTS = new Set([
  'apps',
  'src',
  'packages',
  'app',
  'pages',
  'supabase',
  '.github',
  '.cursor',
  '.vscode',
]);

/** Strip the native picker folder name so paths match CLI (`apps/web/...`). */
export function stripSelectedFolderPrefix(relativePath: string, rootFolderName: string): string {
  const normalized = relativePath.replaceAll('\\', '/');
  const prefix = `${rootFolderName}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}

/**
 * ZIP archives often wrap a single folder. Strip it unless that folder is
 * already a real project root (`apps`, `src`, `packages`, ...).
 */
export function zipRootFolderToStrip(paths: readonly string[]): string | null {
  const normalized = paths.map((path) => path.replaceAll('\\', '/').replace(/^\/+/, ''));
  if (normalized.length === 0) return null;
  const firstSegments = new Set(normalized.map((path) => path.split('/')[0] ?? ''));
  if (firstSegments.size !== 1) return null;
  const root = [...firstSegments][0] ?? '';
  if (!root || PROJECT_ROOT_SEGMENTS.has(root)) return null;
  if (!normalized.some((path) => path.includes('/'))) return null;
  return root;
}

/**
 * Read `.gitignore` first, then skip ignored paths so local secrets never enter
 * the editor or the scanner.
 */
export async function loadProjectFromCandidates(
  candidates: readonly PathCandidate[],
  oversizeMessage = 'Selected project exceeds the 20 MB limit.',
): Promise<ProjectFile[]> {
  const loadable = candidates.filter((candidate) => isLoadablePath(candidate.path));
  const gitignoreInputs: GitIgnoreFileInput[] = [];
  const gitignoreContent = new Map<string, string>();

  for (const candidate of loadable) {
    if (!isGitIgnorePath(candidate.path) || candidate.size > MAX_FILE_BYTES) continue;
    const content = await candidate.read();
    gitignoreInputs.push({ file: candidate.path, content });
    gitignoreContent.set(candidate.path, content);
  }

  const ignoreSources = parseGitIgnoreSources(gitignoreInputs);
  const files: ProjectFile[] = [];
  let totalBytes = 0;

  for (const candidate of loadable) {
    if (files.length >= MAX_PROJECT_FILES) break;
    if (isGitIgnored(candidate.path, ignoreSources)) continue;
    if (candidate.size > MAX_FILE_BYTES) continue;
    const content = gitignoreContent.get(candidate.path) ?? (await candidate.read());
    const bytes = new TextEncoder().encode(content).byteLength;
    if (bytes > MAX_FILE_BYTES) continue;
    totalBytes += bytes;
    if (totalBytes > MAX_PROJECT_BYTES) {
      throw new Error(oversizeMessage);
    }
    files.push({ path: candidate.path, content });
  }

  return files;
}

function directoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: FileSystemEntry[] = [];
    const readBatch = (): void => {
      reader.readEntries((batch) => {
        if (batch.length === 0) return resolve(entries);
        entries.push(...batch);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

export async function readDroppedEntry(entry: FileSystemEntry): Promise<ProjectFile[]> {
  return loadProjectFromCandidates(await collectDroppedCandidates(entry, null));
}

/**
 * `parent === null` means `entry` is the dropped folder (scan root) — do not
 * prefix child paths with its name. Nested folders use a string parent.
 */
async function collectDroppedCandidates(
  entry: FileSystemEntry,
  parent: string | null,
): Promise<PathCandidate[]> {
  if (EXCLUDED_DIRECTORIES.has(entry.name)) return [];

  if (entry.isFile) {
    const relativePath = parent ? `${parent}/${entry.name}` : entry.name;
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    return [{ path: relativePath, size: file.size, read: () => file.text() }];
  }
  if (!entry.isDirectory) return [];

  const children = await directoryEntries((entry as FileSystemDirectoryEntry).createReader());
  const childParent = parent === null ? '' : parent === '' ? entry.name : `${parent}/${entry.name}`;
  const nested = await Promise.all(
    children.map((child) => collectDroppedCandidates(child, childParent)),
  );
  return nested.flat();
}

export async function readDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  parent = '',
): Promise<ProjectFile[]> {
  return loadProjectFromCandidates(await collectDirectoryCandidates(handle, parent));
}

async function collectDirectoryCandidates(
  handle: FileSystemDirectoryHandle,
  parent = '',
): Promise<PathCandidate[]> {
  const candidates: PathCandidate[] = [];
  for await (const entry of handle.values()) {
    if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const relativePath = parent ? `${parent}/${entry.name}` : entry.name;
    if (entry.kind === 'file') {
      const file = await (entry as FileSystemFileHandle).getFile();
      candidates.push({ path: relativePath, size: file.size, read: () => file.text() });
    } else {
      candidates.push(
        ...(await collectDirectoryCandidates(entry as FileSystemDirectoryHandle, relativePath)),
      );
    }
  }
  return candidates;
}

export interface FolderSelectionResult {
  files: ProjectFile[];
  rootFolderName: string;
}

/**
 * Reads a folder selected through a native `<input type="file" webkitdirectory>`
 * picker. This path preserves the browser user-gesture requirement and works in
 * environments where `showDirectoryPicker()` rejects programmatic activation.
 */
export async function readFileListFromInput(
  selectedFiles: readonly File[],
): Promise<FolderSelectionResult> {
  let rootFolderName = '';
  const candidates: PathCandidate[] = [];

  for (const file of selectedFiles) {
    const relativePath = (file.webkitRelativePath || file.name).replaceAll('\\', '/');
    if (!relativePath || relativePath.split('/').includes('..')) continue;

    if (!rootFolderName) {
      rootFolderName = relativePath.includes('/') ? relativePath.split('/')[0] : file.name;
    }

    candidates.push({
      path: stripSelectedFolderPrefix(relativePath, rootFolderName),
      size: file.size,
      read: () => file.text(),
    });
  }

  return {
    files: await loadProjectFromCandidates(candidates),
    rootFolderName: rootFolderName || 'project',
  };
}

export async function readZipFile(file: File): Promise<ProjectFile[]> {
  if (file.size > MAX_PROJECT_BYTES) throw new Error('ZIP archive exceeds the 20 MB upload limit.');
  const archive = await JSZip.loadAsync(await file.arrayBuffer());
  const rawCandidates: PathCandidate[] = [];

  for (const [rawPath, entry] of Object.entries(archive.files)) {
    const originalPath =
      'unsafeOriginalName' in entry && typeof entry.unsafeOriginalName === 'string'
        ? entry.unsafeOriginalName
        : rawPath;
    if (originalPath.split(/[\\/]/).includes('..')) {
      throw new Error('ZIP archive contains an unsafe path.');
    }
    if (entry.dir) continue;
    const path = rawPath.replaceAll('\\', '/').replace(/^\/+/, '');
    rawCandidates.push({
      path,
      size: 0,
      read: () => entry.async('string'),
    });
  }

  const zipRoot = zipRootFolderToStrip(rawCandidates.map((candidate) => candidate.path));
  const candidates = zipRoot
    ? rawCandidates.map((candidate) => ({
        ...candidate,
        path: stripSelectedFolderPrefix(candidate.path, zipRoot),
      }))
    : rawCandidates;

  return loadProjectFromCandidates(candidates, 'Uncompressed project exceeds 20 MB.');
}
