/**
 * Exposure-window context for secret findings on PR checks.
 *
 * Answers "how long has this been public?" by walking GitHub commit history
 * for the finding's file. Attaches a sentence to the existing finding message —
 * never creates a new blocker, never echoes the secret value.
 *
 * Public repos only. For private repos we state that the finding is not
 * publicly exposed rather than inventing a span.
 */
import { z } from 'zod';
import { githubHeaders, githubRepositoryApiUrl, readLimitedResponseText } from './githubApp';
import type { WebFinding } from './browserScanner';

/** Rule ids that represent a secret leak we can attach an exposure window to. */
export const SECRET_EXPOSURE_RULE_IDS: ReadonlySet<string> = new Set([
  'stripe-secret-leak',
  'public-secret',
  'supabase-service-role-leak',
  'ai-llm-key-in-client',
  'stripe-live-key-in-dev',
  'runtime-secret-in-bundle',
  'agent-mcp-inline-secret',
]);

/** Cap on distinct files we will query history for per PR. */
export const EXPOSURE_WINDOW_FILE_CAP = 5;

const commitsSchema = z.array(
  z
    .object({
      sha: z.string().min(1).max(64),
      commit: z
        .object({
          author: z
            .object({
              date: z.string().min(1).optional(),
            })
            .passthrough()
            .optional(),
          committer: z
            .object({
              date: z.string().min(1).optional(),
            })
            .passthrough()
            .optional(),
        })
        .passthrough(),
    })
    .passthrough(),
);

export interface SecretExposureWindow {
  /** Human sentence appended to the finding message. */
  summary: string;
  /** Days since the oldest commit touching the file that we observed; null when unknown. */
  daysExposed: number | null;
  /** Number of commits returned for the path (capped by the API page). */
  commitCount: number | null;
}

export interface ExposureWindowOptions {
  token: string;
  repositoryName: string;
  /** When true, do not compute a public span — say it is not publicly exposed. */
  isPrivate: boolean;
  fetchImpl?: typeof fetch;
  /** Injectable clock for tests. */
  now?: () => number;
  fileCap?: number;
}

function daysBetween(thenIso: string, nowMs: number): number | null {
  const thenMs = Date.parse(thenIso);
  if (!Number.isFinite(thenMs)) return null;
  return Math.max(0, Math.floor((nowMs - thenMs) / (24 * 60 * 60 * 1000)));
}

function formatExposureSummary(days: number, commitCount: number): string {
  const dayLabel = days === 1 ? '1 day' : `${days} days`;
  const commitLabel = commitCount === 1 ? '1 commit' : `${commitCount} commits`;
  return `This key has been in the repository for ${dayLabel} across ${commitLabel}.`;
}

/**
 * Fetches commit history for one path. Returns null when history is unavailable
 * (API failure, empty history, shallow clone) — silence beats a fabricated number.
 */
export async function fetchPathExposureWindow(
  token: string,
  repositoryName: string,
  path: string,
  options: {
    fetchImpl?: typeof fetch;
    now?: () => number;
  } = {},
): Promise<SecretExposureWindow | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowMs = (options.now ?? Date.now)();
  const url = new URL(githubRepositoryApiUrl(repositoryName, 'commits'));
  url.searchParams.set('path', path);
  url.searchParams.set('per_page', '30');

  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: githubHeaders(token),
    });
    if (!response.ok) return null;
    const text = await readLimitedResponseText(response, 256 * 1024);
    const parsed = commitsSchema.safeParse(JSON.parse(text));
    if (!parsed.success || parsed.data.length === 0) return null;

    const commits = parsed.data;
    // GitHub returns newest-first; the last entry is the oldest on this page.
    const oldest = commits[commits.length - 1]!;
    const oldestDate = oldest.commit.author?.date ?? oldest.commit.committer?.date ?? null;
    if (!oldestDate) return null;
    const days = daysBetween(oldestDate, nowMs);
    if (days === null) return null;
    return {
      daysExposed: days,
      commitCount: commits.length,
      summary: formatExposureSummary(days, commits.length),
    };
  } catch {
    return null;
  }
}

function isSecretFinding(finding: WebFinding & { path?: string }): boolean {
  return typeof finding.ruleId === 'string' && SECRET_EXPOSURE_RULE_IDS.has(finding.ruleId);
}

/**
 * Mutates secret findings in place to append exposure-window context.
 * Never introduces a new finding, never changes severity/confidence, never
 * includes a secret value.
 */
export async function attachSecretExposureWindows(
  findings: Array<WebFinding & { path?: string }>,
  options: ExposureWindowOptions,
): Promise<void> {
  const secretFindings = findings.filter(isSecretFinding);
  if (secretFindings.length === 0) return;

  if (options.isPrivate) {
    for (const finding of secretFindings) {
      const note = 'This finding is not publicly exposed (private repository).';
      if (!finding.message.includes(note)) {
        finding.message = `${finding.message} ${note}`;
      }
    }
    return;
  }

  const fileCap = options.fileCap ?? EXPOSURE_WINDOW_FILE_CAP;
  const windowByFile = new Map<string, SecretExposureWindow | null>();
  let filesQueried = 0;

  for (const finding of secretFindings) {
    const path = finding.path || finding.file;
    if (!path) continue;

    if (!windowByFile.has(path)) {
      if (filesQueried >= fileCap) {
        windowByFile.set(path, null);
      } else {
        filesQueried += 1;
        const window = await fetchPathExposureWindow(options.token, options.repositoryName, path, {
          fetchImpl: options.fetchImpl,
          now: options.now,
        });
        windowByFile.set(path, window);
      }
    }

    const window = windowByFile.get(path);
    if (!window) continue;
    if (!finding.message.includes(window.summary)) {
      finding.message = `${finding.message} ${window.summary}`;
    }
  }
}

/** True when a string looks like it might contain a raw secret value we must never emit. */
export function messageContainsPlantedSecret(message: string, secret: string): boolean {
  return secret.length >= 8 && message.includes(secret);
}
