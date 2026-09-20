import { assertScannableUrl } from './urlSafety';

export function normalizeHomepageOrigin(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return assertScannableUrl(withScheme).origin;
  } catch {
    return null;
  }
}

function logHomepageWriteFailure(repoId: string, error: unknown): void {
  console.error(
    JSON.stringify({
      service: 'assurly-api',
      event: 'repo-homepage-write-failed',
      repoId,
      errorType: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
    }),
  );
}

/**
 * Records the public origin GitHub reports as the repository homepage.
 * Best-effort — never throws. A missing field (`undefined`) is not a clear.
 */
export async function learnRepositoryHomepage(
  db: {
    updateRepositoryHomepageUrl(repoId: string, homepageUrl: string | null): Promise<void>;
  },
  repository: { id: string; homepage_url?: string | null },
  rawHomepage: string | null | undefined,
): Promise<void> {
  if (rawHomepage === undefined) return;
  const normalized = normalizeHomepageOrigin(rawHomepage);
  if (normalized === (repository.homepage_url ?? null)) return;
  try {
    await db.updateRepositoryHomepageUrl(repository.id, normalized);
  } catch (error) {
    logHomepageWriteFailure(repository.id, error);
  }
}
