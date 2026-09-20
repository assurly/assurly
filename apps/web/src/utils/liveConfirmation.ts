import { RLS_GENERIC_TABLE_LABEL, RLS_SUPABASE_TABLE_LABEL } from '@assurly/scanner-core';

export interface LiveConfirmableFinding {
  rule_id: string;
  severity: 'error' | 'warning';
  confidence?: 'high' | 'medium' | 'low';
  file_path: string;
  message: string;
  line_number?: number;
  suggestion?: string;
  fix_pr_url?: string | null;
}

export interface LiveProofEvidence {
  kind: string;
  summary: string;
  redactedSample?: {
    table?: string;
    path?: string;
  } | null;
}

export type LiveFindingSubject = { kind: 'table'; table: string } | { kind: 'route'; path: string };

const CONFIRMED_LIVE_MARKER = 'Confirmed live on ';
const ROUTE_EXT = '(?:ts|tsx|js|mjs)';
const APP_ROUTE_FILE = new RegExp(`(?:^|/)app/api/(.+)/route\\.${ROUTE_EXT}$`);
const PAGES_ROUTE_FILE = new RegExp(`(?:^|/)pages/api/(.+)\\.${ROUTE_EXT}$`);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const RLS_TABLE_MESSAGE = new RegExp(
  `^(?:${escapeRegExp(RLS_SUPABASE_TABLE_LABEL)}|${escapeRegExp(RLS_GENERIC_TABLE_LABEL)}) '([^']+)' is created but Row-Level Security \\(RLS\\) is not enabled\\.$`,
);
const AUTH_LINKED_MESSAGE =
  /^Table '([^']+)' references auth\.users but Row-Level Security \(RLS\) is not enabled\.$/;
const PERMISSIVE_MESSAGE =
  /^RLS policy on '([^']+)' uses USING \(true\) and is effectively open to everyone\.$/;

function isRouteGroup(part: string): boolean {
  return /^\([^/]+\)$/.test(part);
}

function isDynamicSegment(part: string): boolean {
  return /^\[[^\]]+\]$/.test(part) || /^\[\[\.\.\.[^\]]+\]\]$/.test(part);
}

function segmentsToApiPath(raw: string, options?: { dropIndex?: boolean }): string | null {
  const parts = raw.split('/').filter((part) => part.length > 0 && !isRouteGroup(part));
  if (parts.some(isDynamicSegment)) return null;
  if (options?.dropIndex && parts[parts.length - 1] === 'index') {
    parts.pop();
  }
  if (parts.length === 0) return null;
  return `/api/${parts.join('/')}`;
}

export function routeFileToApiPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/');
  const appMatch = normalized.match(APP_ROUTE_FILE);
  if (appMatch) return segmentsToApiPath(appMatch[1]);
  const pagesMatch = normalized.match(PAGES_ROUTE_FILE);
  if (pagesMatch) return segmentsToApiPath(pagesMatch[1], { dropIndex: true });
  return null;
}

function firstCapture(pattern: RegExp, message: string): string | null {
  const match = message.match(pattern);
  return match?.[1] ?? null;
}

export function staticFindingSubject(
  finding: Pick<LiveConfirmableFinding, 'rule_id' | 'message' | 'file_path'>,
): LiveFindingSubject | null {
  switch (finding.rule_id) {
    case 'supabase-rls': {
      const table = firstCapture(RLS_TABLE_MESSAGE, finding.message);
      return table ? { kind: 'table', table } : null;
    }
    case 'supabase-migration-auth-linked-no-rls': {
      const table = firstCapture(AUTH_LINKED_MESSAGE, finding.message);
      return table ? { kind: 'table', table } : null;
    }
    case 'supabase-policy-permissive': {
      const table = firstCapture(PERMISSIVE_MESSAGE, finding.message);
      return table ? { kind: 'table', table } : null;
    }
    case 'auth-route-handler-unprotected': {
      const path = routeFileToApiPath(finding.file_path);
      return path ? { kind: 'route', path } : null;
    }
    // Deliberately not mapped:
    // - auth-route-handler-mutates-unguarded: a GET that answers without a
    //   session does not prove the mutating handler is unguarded — a different
    //   verb; a wrong blocker costs more trust than a missed escalation.
    // - api-route-unvalidated-input: the probe proves nothing about validation.
    default:
      return null;
  }
}

function evidenceMatches(subject: LiveFindingSubject, item: LiveProofEvidence): boolean {
  if (subject.kind === 'table') {
    return item.kind === 'rls_rows' && item.redactedSample?.table === subject.table;
  }
  return item.kind === 'open_endpoint' && item.redactedSample?.path === subject.path;
}

function ambiguousRoutePaths(findings: readonly LiveConfirmableFinding[]): Set<string> {
  const filesByPath = new Map<string, Set<string>>();
  for (const finding of findings) {
    const subject = staticFindingSubject(finding);
    if (subject?.kind !== 'route') continue;
    const files = filesByPath.get(subject.path) ?? new Set<string>();
    files.add(finding.file_path);
    filesByPath.set(subject.path, files);
  }
  const ambiguous = new Set<string>();
  for (const [path, files] of filesByPath) {
    if (files.size > 1) ambiguous.add(path);
  }
  return ambiguous;
}

export function confirmFindingsLive<T extends LiveConfirmableFinding>(
  findings: readonly T[],
  evidence: readonly LiveProofEvidence[],
  origin: string,
): { findings: T[]; confirmed: number } {
  const ambiguousPaths = ambiguousRoutePaths(findings);
  let confirmed = 0;
  const next = findings.map((finding) => {
    if (finding.message.includes(CONFIRMED_LIVE_MARKER)) {
      return { ...finding };
    }
    const subject = staticFindingSubject(finding);
    if (!subject) return { ...finding };
    if (subject.kind === 'route' && ambiguousPaths.has(subject.path)) {
      return { ...finding };
    }
    const match = evidence.find((item) => evidenceMatches(subject, item));
    if (!match) return { ...finding };
    confirmed += 1;
    return {
      ...finding,
      confidence: 'high' as const,
      message: `${finding.message} Confirmed live on ${origin}: ${match.summary}`,
    };
  });
  return { findings: next, confirmed };
}
