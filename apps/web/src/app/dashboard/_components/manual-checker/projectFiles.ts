import JSZip from 'jszip';
import { isScannableFile } from '../../../../utils/browserScanner';
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
const SUPPORTED_FILE = /(?:\.sql|\.env|\.env\.example|\.[jt]sx?|\.json)$/i;
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

function allowedPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  const segments = normalized.split('/');
  return (
    !segments.some((segment) => EXCLUDED_DIRECTORIES.has(segment)) &&
    SUPPORTED_FILE.test(normalized) &&
    isScannableFile(normalized)
  );
}

async function readBrowserFile(file: File, path: string): Promise<ProjectFile[]> {
  if (!allowedPath(path) || file.size > MAX_FILE_BYTES) return [];
  return [{ path, content: await file.text() }];
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

export async function readDroppedEntry(
  entry: FileSystemEntry,
  parent = '',
): Promise<ProjectFile[]> {
  if (EXCLUDED_DIRECTORIES.has(entry.name)) return [];
  const relativePath = parent ? `${parent}/${entry.name}` : entry.name;

  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    return readBrowserFile(file, relativePath);
  }
  if (!entry.isDirectory) return [];

  const children = await directoryEntries((entry as FileSystemDirectoryEntry).createReader());
  const nested = await Promise.all(children.map((child) => readDroppedEntry(child, relativePath)));
  return nested.flat().slice(0, MAX_PROJECT_FILES);
}

export async function readDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  parent = '',
): Promise<ProjectFile[]> {
  const files: ProjectFile[] = [];
  for await (const entry of handle.values()) {
    if (EXCLUDED_DIRECTORIES.has(entry.name) || files.length >= MAX_PROJECT_FILES) continue;
    const relativePath = parent ? `${parent}/${entry.name}` : entry.name;
    if (entry.kind === 'file') {
      files.push(
        ...(await readBrowserFile(await (entry as FileSystemFileHandle).getFile(), relativePath)),
      );
    } else {
      files.push(...(await readDirectoryHandle(entry as FileSystemDirectoryHandle, relativePath)));
    }
  }
  return files.slice(0, MAX_PROJECT_FILES);
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
  const files: ProjectFile[] = [];
  let totalBytes = 0;
  let rootFolderName = '';

  for (const file of selectedFiles) {
    if (files.length >= MAX_PROJECT_FILES) break;

    const relativePath = (file.webkitRelativePath || file.name).replaceAll('\\', '/');
    if (!relativePath || relativePath.split('/').includes('..')) continue;

    if (!rootFolderName) {
      rootFolderName = relativePath.includes('/') ? relativePath.split('/')[0] : file.name;
    }

    const contentFiles = await readBrowserFile(file, relativePath);
    for (const projectFile of contentFiles) {
      const bytes = new TextEncoder().encode(projectFile.content).byteLength;
      totalBytes += bytes;
      if (totalBytes > MAX_PROJECT_BYTES) {
        throw new Error('Selected project exceeds the 20 MB limit.');
      }
      files.push(projectFile);
      if (files.length >= MAX_PROJECT_FILES) break;
    }
  }

  return { files, rootFolderName: rootFolderName || 'project' };
}

export async function readZipFile(file: File): Promise<ProjectFile[]> {
  if (file.size > MAX_PROJECT_BYTES) throw new Error('ZIP archive exceeds the 20 MB upload limit.');
  const archive = await JSZip.loadAsync(await file.arrayBuffer());
  const files: ProjectFile[] = [];
  let totalBytes = 0;

  for (const [rawPath, entry] of Object.entries(archive.files)) {
    const originalPath =
      'unsafeOriginalName' in entry && typeof entry.unsafeOriginalName === 'string'
        ? entry.unsafeOriginalName
        : rawPath;
    if (originalPath.split(/[\\/]/).includes('..')) {
      throw new Error('ZIP archive contains an unsafe path.');
    }
    if (entry.dir || !allowedPath(rawPath)) continue;
    if (files.length >= MAX_PROJECT_FILES) throw new Error('ZIP archive contains too many files.');
    const path = rawPath.replaceAll('\\', '/').replace(/^\/+/, '');
    const content = await entry.async('string');
    const bytes = new TextEncoder().encode(content).byteLength;
    if (bytes > MAX_FILE_BYTES) continue;
    totalBytes += bytes;
    if (totalBytes > MAX_PROJECT_BYTES) throw new Error('Uncompressed project exceeds 20 MB.');
    files.push({ path, content });
  }
  return files;
}
