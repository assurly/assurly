export class PublicScanRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicScanRateLimitError';
  }
}

interface BatchFileEntry {
  path?: unknown;
  content?: unknown;
}

interface BatchResponse {
  files?: BatchFileEntry[];
}

function fileUrl(repo: string, branch: string, path: string): string {
  return `/api/github/public-scan?repo=${encodeURIComponent(repo)}&branch=${encodeURIComponent(
    branch,
  )}&type=file&path=${encodeURIComponent(path)}`;
}

async function readRateLimitMessage(response: Response): Promise<string> {
  const fallback = 'GitHub API rate limit exceeded. Sign in with GitHub to scan more repositories.';
  try {
    const data = (await response.json()) as { error?: string | { message?: string } };
    if (typeof data.error === 'string' && data.error.length > 0) return data.error;
    if (data.error && typeof data.error === 'object' && data.error.message) {
      return data.error.message;
    }
  } catch {
    // Keep the fallback when the body is not JSON.
  }
  return fallback;
}

/**
 * Nested README.md files are treated as agent-instruction candidates by the
 * engine, but fetching every docs README over GitHub turns a public scan into
 * minutes of serial round trips. Root README.md still ships.
 */
export function isNestedReadme(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const name = normalized.split('/').pop()?.toLowerCase();
  return name === 'readme.md' && normalized.includes('/');
}

/**
 * One POST to `/api/github/public-scan` pulls every path the landing-page scan
 * needs. Falls back to per-file GET only when the batch endpoint fails for a
 * non-rate-limit reason.
 */
export async function prefetchPublicScanFiles(options: {
  repo: string;
  branch: string;
  paths: readonly string[];
  fetchImpl?: typeof fetch;
}): Promise<Map<string, string | null>> {
  const { repo, branch, paths, fetchImpl = fetch } = options;
  const uniquePaths = [...new Set(paths)];
  const contentCache = new Map<string, string | null>();
  if (uniquePaths.length === 0) return contentCache;

  try {
    const response = await fetchImpl('/api/github/public-scan', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ repo, branch, paths: uniquePaths }),
    });
    if (response.status === 429) {
      throw new PublicScanRateLimitError(await readRateLimitMessage(response));
    }
    if (response.ok) {
      const data = (await response.json()) as BatchResponse;
      for (const entry of data.files ?? []) {
        if (typeof entry?.path === 'string') {
          contentCache.set(entry.path, typeof entry.content === 'string' ? entry.content : null);
        }
      }
      for (const path of uniquePaths) {
        if (!contentCache.has(path)) contentCache.set(path, null);
      }
      return contentCache;
    }
  } catch (error: unknown) {
    if (error instanceof PublicScanRateLimitError) throw error;
    // Transient batch failure: fall through to per-file GETs.
  }

  for (const path of uniquePaths) {
    try {
      const response = await fetchImpl(fileUrl(repo, branch, path));
      if (response.status === 429) {
        throw new PublicScanRateLimitError(await readRateLimitMessage(response));
      }
      contentCache.set(path, response.ok ? await response.text() : null);
    } catch (error: unknown) {
      if (error instanceof PublicScanRateLimitError) throw error;
      contentCache.set(path, null);
    }
  }
  return contentCache;
}
