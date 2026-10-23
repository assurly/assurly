/**
 * The few lines of source behind a finding, as the dashboard shows them. Pure:
 * no fetching here. Source is read from GitHub at display time and never
 * stored, and any value that looks like a credential is masked before a line
 * leaves the server.
 */

/** Lines shown either side of the finding's line. */
export const SNIPPET_RADIUS = 5;
/** A minified line is cut here; the finding still points at the right line. */
export const MAX_SNIPPET_LINE_CHARS = 240;

const MASK = '••••••••';

/**
 * Files Assurly never displays, whatever the finding says: real env files and
 * key material. Example env files are documentation and stay readable.
 */
export function isSensitiveSourcePath(filePath: string): boolean {
  const name = filePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
  if (/^\.env(?:\.|$)/.test(name)) return !/\.(?:example|sample|template|dist)$/.test(name);
  return (
    /\.(?:pem|key|p12|pfx|jks|keystore)$/.test(name) || /^id_(?:rsa|dsa|ecdsa|ed25519)$/.test(name)
  );
}

/**
 * Provider credentials. Group 1 is the prefix that says what the value is and
 * stays visible; everything after it is masked.
 */
const PROVIDER_SECRETS: RegExp[] = [
  /\b((?:sk|rk)_(?:live|test)_)[A-Za-z0-9]{8,}/g,
  /\b(whsec_)[A-Za-z0-9]{8,}/g,
  /\b(sk-(?:proj-|ant-[a-z0-9]+-)?)[A-Za-z0-9_-]{16,}/g,
  /\b(gh[pousr]_)[A-Za-z0-9]{20,}/g,
  /\b(github_pat_)[A-Za-z0-9_]{20,}/g,
  /\b((?:AKIA|ASIA))[0-9A-Z]{16}\b/g,
  /\b(AIza)[0-9A-Za-z_-]{35}/g,
  /\b(xox[abposr]-)[A-Za-z0-9-]{10,}/g,
  /\b(sb_secret_)[A-Za-z0-9_-]{16,}/g,
  // JWTs: a Supabase service_role key is one.
  /\b(eyJ)[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];

/**
 * `scheme://user:password@host`: the user stays, the password goes. The scheme
 * is bounded so a long dotted line cannot make the match quadratic.
 */
const CONNECTION_STRING_PASSWORD = /\b([a-z][a-z0-9+.-]{0,30}:\/\/[^:\s/@'"`]+:)[^@\s'"`]+(@)/gi;

/**
 * A string literal assigned to an identifier. The name is checked separately
 * (SECRET_NAME) so the pattern itself never backtracks around a keyword.
 */
const ASSIGNED_STRING = /\b([A-Za-z_][A-Za-z0-9_]*)(['"]?\s*[:=]\s*)(['"`])([^'"`\s]{8,})\3/g;
const SECRET_NAME = /secret|token|passw(?:or)?d|private_?key|api_?key|service_?role/i;

const PEM_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const PEM_END = /-----END [A-Z ]*PRIVATE KEY-----/;
const PEM_ON_ONE_LINE =
  /(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g;

function redactLine(line: string): { text: string; count: number } {
  let count = 0;
  const masked = (replacement: string) => {
    count += 1;
    return replacement;
  };
  let text = line.replace(PEM_ON_ONE_LINE, (_match, begin: string, end: string) =>
    masked(`${begin}${MASK}${end}`),
  );
  for (const pattern of PROVIDER_SECRETS) {
    text = text.replace(pattern, (_match, prefix: string) => masked(`${prefix}${MASK}`));
  }
  text = text.replace(CONNECTION_STRING_PASSWORD, (_match, head: string, at: string) =>
    masked(`${head}${MASK}${at}`),
  );
  text = text.replace(
    ASSIGNED_STRING,
    (match, name: string, operator: string, quote: string, value: string) =>
      !SECRET_NAME.test(name) || value.includes(MASK)
        ? match
        : masked(`${name}${operator}${quote}${MASK}${quote}`),
  );
  return { text, count };
}

function splitLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
}

/**
 * Every line of a file with credentials masked. Runs over the whole file so a
 * window that starts inside a multi-line private key still hides its body.
 */
export function redactSecrets(content: string): { lines: string[]; redactedCount: number } {
  let redactedCount = 0;
  let insideKey = false;
  const lines = splitLines(content).map((line) => {
    if (insideKey) {
      if (PEM_END.test(line)) {
        insideKey = false;
        return line;
      }
      redactedCount += 1;
      return MASK;
    }
    if (PEM_BEGIN.test(line) && !PEM_END.test(line)) {
      insideKey = true;
      return line;
    }
    const { text, count } = redactLine(line);
    redactedCount += count;
    return text;
  });
  return { lines, redactedCount };
}

export interface CodeWindow {
  /** 1-based line number of `lines[0]`. */
  startLine: number;
  lines: string[];
  /** The finding's line, or null when it has none or the file is shorter now. */
  highlightLine: number | null;
  /** Credentials masked inside the window. */
  redactedCount: number;
}

function truncate(line: string): string {
  return line.length > MAX_SNIPPET_LINE_CHARS ? `${line.slice(0, MAX_SNIPPET_LINE_CHARS)}…` : line;
}

export function buildCodeWindow(content: string, line: number | null | undefined): CodeWindow {
  const all = splitLines(content);
  const hasLine = typeof line === 'number' && line >= 1;
  // A file shorter than the finding's line changed since the scan: show its end.
  const center = hasLine ? Math.min(line, all.length) : null;
  const startLine = center === null ? 1 : Math.max(1, center - SNIPPET_RADIUS);
  const endLine = Math.min(
    all.length,
    center === null ? SNIPPET_RADIUS * 2 + 1 : center + SNIPPET_RADIUS,
  );

  const redacted = redactSecrets(content);
  const before = all.slice(startLine - 1, endLine);
  const lines = redacted.lines.slice(startLine - 1, endLine);
  const redactedCount = lines.filter((text, index) => text !== before[index]).length;
  return {
    startLine,
    lines: lines.map(truncate),
    highlightLine: hasLine && line <= all.length ? line : null,
    redactedCount,
  };
}

export type DiffLine =
  | { kind: 'context'; text: string; oldLine: number; newLine: number }
  | { kind: 'remove'; text: string; oldLine: number }
  | { kind: 'add'; text: string; newLine: number };

/**
 * A unified diff for a change confined to one contiguous block, which is every
 * change Assurly's auto-fix makes (append, new file, one replaced line). Common
 * leading and trailing lines are context; the rest is removed and added.
 */
export function singleHunkDiff(before: string, after: string, context = 3): DiffLine[] {
  const oldLines = before === '' ? [] : splitLines(before);
  const newLines = after === '' ? [] : splitLines(after);

  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const removedEnd = oldLines.length - suffix;
  const addedEnd = newLines.length - suffix;
  if (prefix === removedEnd && prefix === addedEnd) return [];

  const diff: DiffLine[] = [];
  for (let index = Math.max(0, prefix - context); index < prefix; index += 1) {
    diff.push({ kind: 'context', text: oldLines[index], oldLine: index + 1, newLine: index + 1 });
  }
  for (let index = prefix; index < removedEnd; index += 1) {
    diff.push({ kind: 'remove', text: oldLines[index], oldLine: index + 1 });
  }
  for (let index = prefix; index < addedEnd; index += 1) {
    diff.push({ kind: 'add', text: newLines[index], newLine: index + 1 });
  }
  const shift = addedEnd - removedEnd;
  for (
    let index = removedEnd;
    index < Math.min(oldLines.length, removedEnd + context);
    index += 1
  ) {
    diff.push({
      kind: 'context',
      text: oldLines[index],
      oldLine: index + 1,
      newLine: index + 1 + shift,
    });
  }
  return diff;
}
