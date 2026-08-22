import ignore from 'ignore';

export interface GitIgnoreFileInput {
  file: string;
  content: string;
}

/** Directory containing a `.gitignore` (`''` for repo root) plus its patterns. */
export interface GitIgnoreSource {
  dir: string;
  content: string;
}

function posixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

/** True when `filePath` is a `.gitignore` at any directory depth. */
export function isGitIgnorePath(filePath: string): boolean {
  return /(^|\/)\.gitignore$/.test(posixPath(filePath));
}

/**
 * Assurly env-docs surface (`envRules` / `scanWorkspaceFiles` `allExamples`).
 * Browser gitignore has no git index, so create-next-app `.env*` would otherwise
 * hide a committed `.env.example` that CLI still scans as a tracked file.
 * `.env` / `.env.local` stay ignorable.
 */
export function isAssurlyEnvExamplePath(filePath: string): boolean {
  return /(?:^|\/)\.env\.example$/i.test(posixPath(filePath));
}

/**
 * Collect nested `.gitignore` files, root first so closer rules can un-ignore.
 */
export function parseGitIgnoreSources(files: readonly GitIgnoreFileInput[]): GitIgnoreSource[] {
  return files
    .filter((file) => isGitIgnorePath(file.file))
    .map((file) => {
      const normalized = posixPath(file.file);
      const slash = normalized.lastIndexOf('/');
      return {
        dir: slash === -1 ? '' : normalized.slice(0, slash),
        content: file.content,
      };
    })
    .sort((left, right) => left.dir.length - right.dir.length || left.dir.localeCompare(right.dir));
}

/**
 * Gitignore match for a path relative to the project root (after folder-prefix strip).
 * `.gitignore` files and Assurly `.env.example` docs are never treated as ignored.
 */
export function isGitIgnored(relativePath: string, sources: readonly GitIgnoreSource[]): boolean {
  const posix = posixPath(relativePath);
  if (!posix || isGitIgnorePath(posix) || isAssurlyEnvExamplePath(posix)) return false;

  let ignored = false;
  for (const source of sources) {
    if (source.dir && posix !== source.dir && !posix.startsWith(`${source.dir}/`)) {
      continue;
    }
    const relative = source.dir ? posix.slice(source.dir.length + 1) : posix;
    if (!relative) continue;

    const result = ignore().add(source.content).test(relative);
    if (result.unignored) ignored = false;
    else if (result.ignored) ignored = true;
  }
  return ignored;
}

/**
 * Drop gitignored inputs. Missing `.gitignore` → identity. `.gitignore` files stay.
 */
export function excludeGitIgnoredFiles<T extends GitIgnoreFileInput>(files: readonly T[]): T[] {
  const sources = parseGitIgnoreSources(files);
  if (sources.length === 0) return [...files];
  return files.filter((file) => !isGitIgnored(file.file, sources));
}
