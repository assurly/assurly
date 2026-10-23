import type { ScanFinding } from './dbAdapter';
import {
  buildCodeWindow,
  isSensitiveSourcePath,
  redactSecrets,
  singleHunkDiff,
} from './codeSnippet';
import type { CodeWindow, DiffLine } from './codeSnippet';
import {
  applyAutoFixToFileContent,
  buildGitHubAutoFix,
  isAutoFixableFinding,
  isRlsAutoFix,
  resolveAutoFixTargetPath,
  rlsFixRefusalReason,
} from './githubAutoFix';
import {
  encodeGitHubPath,
  GITHUB_FETCH_TIMEOUT_MS,
  githubContentsApiUrl,
  githubHeaders,
  readLimitedResponseText,
} from './githubApp';

/** Source files larger than this are not fetched for a snippet. */
export const FINDING_CODE_MAX_BYTES = 512 * 1024;

const COMMIT_SHA = /^[0-9a-f]{7,64}$/i;

export type FindingCodeUnavailableReason =
  | 'not_located'
  | 'no_commit'
  | 'sensitive_file'
  | 'file_missing'
  | 'too_large'
  | 'binary'
  | 'repository_unreachable';

/** The change Assurly's auto-fix would commit for this finding, as a diff. */
export interface SuggestedChange {
  title: string;
  description: string;
  file: string;
  isNewFile: boolean;
  lines: DiffLine[];
}

export type FindingCode =
  | {
      available: true;
      file: string;
      commitSha: string;
      githubUrl: string;
      window: CodeWindow;
      suggestedChange: SuggestedChange | null;
    }
  | {
      available: false;
      reason: FindingCodeUnavailableReason;
      message: string;
      githubUrl: string | null;
    };

export interface FindingCodeInput {
  repositoryName: string;
  commitSha: string | null | undefined;
  finding: Pick<ScanFinding, 'file_path' | 'line_number' | 'message' | 'rule_id' | 'severity'>;
  /**
   * GitHub tokens to try in order: the installation's, then the signed-in
   * user's or the server's. `undefined` reads a public repository anonymously.
   */
  tokens: readonly (string | undefined)[];
  fetchImpl?: typeof fetch;
}

type FileRead =
  | { status: 'ok'; content: string }
  | { status: 'missing' | 'too_large' | 'unreachable' };

/** Reads one file at one commit, trying each token until GitHub answers. */
async function readFileAtCommit(
  repositoryName: string,
  path: string,
  commitSha: string,
  tokens: readonly (string | undefined)[],
  fetchImpl: typeof fetch,
): Promise<FileRead> {
  let sawMissing = false;
  for (const token of tokens.length > 0 ? tokens : [undefined]) {
    let response: Response;
    try {
      response = await fetchImpl(githubContentsApiUrl(repositoryName, path, commitSha), {
        headers: githubHeaders(token, 'application/vnd.github.raw+json'),
        signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
      });
    } catch {
      continue;
    }
    if (response.status === 404) {
      sawMissing = true;
      continue;
    }
    if (!response.ok) continue;
    try {
      return {
        status: 'ok',
        content: await readLimitedResponseText(response, FINDING_CODE_MAX_BYTES),
      };
    } catch {
      return { status: 'too_large' };
    }
  }
  return { status: sawMissing ? 'missing' : 'unreachable' };
}

function isSafeRepositoryPath(path: string): boolean {
  try {
    encodeGitHubPath(path);
    return path.length <= 1024;
  } catch {
    return false;
  }
}

function blobUrl(repositoryName: string, commitSha: string, path: string, line?: number): string {
  const anchor = line && line > 0 ? `#L${line}` : '';
  return `https://github.com/${repositoryName}/blob/${commitSha}/${encodeGitHubPath(path)}${anchor}`;
}

function unavailable(
  reason: FindingCodeUnavailableReason,
  message: string,
  githubUrl: string | null = null,
): FindingCode {
  return { available: false, reason, message, githubUrl };
}

function redactDiff(lines: DiffLine[]): DiffLine[] {
  return lines.map((line) => ({ ...line, text: redactSecrets(line.text).lines[0] ?? '' }));
}

/** The auto-fix for this finding rendered against the file it would change. */
async function suggestChange(
  input: FindingCodeInput,
  commitSha: string,
  sourceContent: string,
  fetchImpl: typeof fetch,
): Promise<SuggestedChange | null> {
  const { finding } = input;
  if (!isAutoFixableFinding(finding)) return null;
  let fix: ReturnType<typeof buildGitHubAutoFix>;
  try {
    fix = buildGitHubAutoFix(finding.file_path, finding.message, finding.rule_id);
  } catch {
    return null;
  }
  if (!fix) return null;
  // The same dialect gate the pull request applies: no RLS fix for MySQL.
  if (isRlsAutoFix(fix) && rlsFixRefusalReason(finding.file_path, sourceContent)) return null;

  const target = resolveAutoFixTargetPath(finding.file_path, fix);
  if (!isSafeRepositoryPath(target) || isSensitiveSourcePath(target)) return null;
  let before = sourceContent;
  let isNewFile = false;
  if (target !== finding.file_path) {
    const read = await readFileAtCommit(
      input.repositoryName,
      target,
      commitSha,
      input.tokens,
      fetchImpl,
    );
    if (read.status === 'missing') {
      before = '';
      isNewFile = true;
    } else if (read.status === 'ok') {
      before = read.content;
    } else {
      return null;
    }
  }

  const lines = singleHunkDiff(before, applyAutoFixToFileContent(before, fix));
  if (lines.length === 0) return null;
  return {
    title: fix.title,
    description: fix.description,
    file: target,
    isNewFile,
    lines: redactDiff(lines),
  };
}

/**
 * The source behind a finding, read from GitHub at the exact commit the scan
 * read. Nothing here is stored or logged: the lines go straight to the caller
 * with every credential masked, and `.env` files and key material are never
 * fetched at all.
 */
export async function loadFindingCode(input: FindingCodeInput): Promise<FindingCode> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const path = input.finding.file_path;
  if (!path || path === 'unknown' || !isSafeRepositoryPath(path)) {
    return unavailable(
      'not_located',
      'This finding is about the project as a whole, not one file.',
    );
  }
  const commitSha = input.commitSha ?? '';
  if (!COMMIT_SHA.test(commitSha)) {
    return unavailable(
      'no_commit',
      'This scan did not record which commit it read, so its code cannot be shown exactly. Rescan to see it.',
    );
  }

  const line = input.finding.line_number ?? undefined;
  const githubUrl = blobUrl(input.repositoryName, commitSha, path, line);
  if (isSensitiveSourcePath(path)) {
    return unavailable(
      'sensitive_file',
      'Assurly never displays env files or key material. Open the file on your machine to see this line.',
    );
  }

  const read = await readFileAtCommit(
    input.repositoryName,
    path,
    commitSha,
    input.tokens,
    fetchImpl,
  );
  if (read.status === 'missing') {
    return unavailable(
      'file_missing',
      'GitHub did not return this file at the scanned commit. It may have moved, or Assurly no longer has access to the repository.',
      githubUrl,
    );
  }
  if (read.status === 'too_large') {
    return unavailable('too_large', 'This file is too large to show here.', githubUrl);
  }
  if (read.status !== 'ok') {
    return unavailable(
      'repository_unreachable',
      'GitHub is not answering right now. Try again in a moment.',
      githubUrl,
    );
  }
  if (read.content.includes('\u0000')) {
    return unavailable('binary', 'This is a binary file.', githubUrl);
  }

  return {
    available: true,
    file: path,
    commitSha,
    githubUrl,
    window: buildCodeWindow(read.content, line),
    suggestedChange: await suggestChange(input, commitSha, read.content, fetchImpl),
  };
}
