import { parse } from '@babel/parser';
import type { Node } from '@babel/types';
import {
  buildScanScope,
  formatScanScopeSummary,
  getFileRelevanceScore,
  inferScanRoots,
  isScannableFile,
  rankFilesByRelevance,
  type ScanScope,
} from './fileRelevance';

export type Severity = 'error' | 'warning';

export type FindingConfidence = 'high' | 'medium' | 'low';

export interface ScannerFinding {
  ruleId: string;
  severity: Severity;
  /** Defaults to 'high' so existing high-precision rules stay blockers. */
  confidence?: FindingConfidence;
  message: string;
  suggestion?: string;
  file?: string;
  line?: number;
}

export interface ScanResult {
  errorCount: number;
  warningCount: number;
  findings: ScannerFinding[];
}

export interface SourceInput {
  file: string;
  content: string;
}

export interface FileSelection<T> {
  files: T[];
  total: number;
  complete: boolean;
  limit: number | null;
}

type AstNode = Node & Record<string, unknown>;

const result = (findings: ScannerFinding[]): ScanResult => ({
  errorCount: findings.filter((finding) => finding.severity === 'error').length,
  warningCount: findings.filter((finding) => finding.severity === 'warning').length,
  findings,
});

export function selectFiles<T>(files: readonly T[], maxFiles?: number): FileSelection<T> {
  const limit = maxFiles === undefined ? null : Math.max(1, Math.floor(maxFiles));
  const selected = limit === null ? [...files] : files.slice(0, limit);
  return {
    files: selected,
    total: files.length,
    complete: selected.length === files.length,
    limit,
  };
}

export function incompleteScanFinding(selection: FileSelection<unknown>): ScannerFinding | null {
  if (selection.complete) return null;
  return {
    ruleId: 'scan-completeness',
    severity: 'warning',
    message: `Scan is incomplete: analyzed ${selection.files.length} of ${selection.total} eligible files (configured limit: ${selection.limit}).`,
    suggestion:
      'Increase the scanner file limit or run the local CLI for a complete repository scan.',
  };
}

function parseCode(content: string): AstNode {
  return parse(content, {
    sourceType: 'unambiguous',
    errorRecovery: true,
    plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties', 'topLevelAwait'],
  }) as unknown as AstNode;
}

function walk(node: unknown, visit: (node: AstNode) => void): void {
  if (!node || typeof node !== 'object') return;
  const candidate = node as Record<string, unknown>;
  if (typeof candidate.type === 'string') visit(candidate as AstNode);
  for (const [key, value] of Object.entries(candidate)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra') continue;
    if (Array.isArray(value)) value.forEach((item) => walk(item, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

const lineOf = (node: AstNode): number | undefined =>
  (node.loc as { start?: { line?: number } } | undefined)?.start?.line;

const memberName = (node: AstNode): string | null => {
  if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return null;
  const property = node.property as AstNode | undefined;
  if (!property) return null;
  if (property.type === 'Identifier') return String(property.name);
  if (property.type === 'StringLiteral') return String(property.value);
  return null;
};

export function scanStripeWebhook(content: string, file = 'route.ts'): ScanResult {
  const findings: ScannerFinding[] = [];
  let ast: AstNode;
  try {
    ast = parseCode(content);
  } catch {
    return result(findings);
  }

  let importsStripe = false;
  let readsStripeSignature = false;
  let usesStripeWebhookApi = false;
  let verifiesSignature = false;
  walk(ast, (node) => {
    if (node.type === 'ImportDeclaration') {
      const source = node.source as { value?: unknown } | undefined;
      if (source?.value === 'stripe') importsStripe = true;
    }
    if (node.type === 'StringLiteral' && node.value === 'stripe-signature') {
      readsStripeSignature = true;
    }
    if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
      if (memberName(node) === 'webhooks') usesStripeWebhookApi = true;
    }
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const callee = node.callee as AstNode | undefined;
      const name = callee ? memberName(callee) : null;
      if (name === 'constructEvent' || name === 'constructEventAsync') verifiesSignature = true;
    }
  });

  const webhookPath = /(^|[/\\._-])webhooks?([/\\._-]|$)/i.test(file) || !/[\\/]/.test(file);
  if (
    (webhookPath || readsStripeSignature || usesStripeWebhookApi) &&
    importsStripe &&
    !verifiesSignature
  ) {
    findings.push({
      ruleId: 'stripe-webhook-signature',
      severity: 'error',
      file,
      line: 1,
      message: 'Stripe webhook endpoint appears to lack signature verification.',
      suggestion:
        'Verify the raw request body with stripe.webhooks.constructEvent before processing the event.',
    });
  }
  return result(findings);
}

const serverPackages = new Set([
  'server-only',
  '@prisma/client',
  'pg',
  'mysql2',
  'mongodb',
  'mongoose',
  'redis',
  'sequelize',
]);
const sensitiveProps = new Set([
  'password',
  'secret',
  'token',
  'apikey',
  'privatekey',
  'clientsecret',
  'hashedpassword',
  'salt',
  'hash',
  'dbclient',
]);

export function scanRscDataLeaks(content: string, file = 'component.tsx'): ScanResult {
  const findings: ScannerFinding[] = [];
  let ast: AstNode;
  try {
    ast = parseCode(content);
  } catch {
    return result(findings);
  }
  const program = ast.program as { directives?: Array<{ value?: { value?: string } }> } | undefined;
  const isClient =
    program?.directives?.some((directive) => directive.value?.value === 'use client') ?? false;

  walk(ast, (node) => {
    if (isClient && node.type === 'ImportDeclaration') {
      const source = String((node.source as { value?: unknown } | undefined)?.value ?? '');
      const lower = source.toLowerCase();
      const unsafe =
        [...serverPackages].some((pkg) => lower === pkg || lower.startsWith(`${pkg}/`)) ||
        ((source.startsWith('.') || source.startsWith('@/')) &&
          (lower.includes('/db') ||
            lower.endsWith('/db') ||
            lower.includes('prisma') ||
            lower.includes('supabaseadmin')));
      if (unsafe)
        findings.push({
          ruleId: 'rsc-data-leaks',
          severity: 'error',
          // Heuristic: cannot distinguish `import type` from runtime imports.
          confidence: 'medium',
          file,
          line: lineOf(node),
          message: `Client Component imports server-side module '${source}'.`,
          suggestion:
            'Move database and secret-bearing code behind a Server Component, Server Action, or authenticated Route Handler.',
        });
    }
    if (!isClient && node.type === 'JSXAttribute') {
      const nameNode = node.name as { name?: unknown } | undefined;
      const name = String(nameNode?.name ?? '').toLowerCase();
      const value = node.value as AstNode | undefined;
      if (sensitiveProps.has(name) && value?.type === 'JSXExpressionContainer')
        findings.push({
          ruleId: 'rsc-data-leaks',
          severity: 'warning',
          file,
          line: lineOf(node),
          message: `Potential Data Leak: sensitive prop '${name}' is serialized through JSX.`,
          suggestion: 'Pass only explicitly selected, non-sensitive fields to client boundaries.',
        });
    }
  });
  return result(findings);
}

const heavyImports: Record<string, [string, string]> = {
  lodash: [
    "Importing the entire 'lodash' library slows serverless cold starts.",
    'Use a selective subpath import or a tree-shakeable alternative.',
  ],
  'aws-sdk': [
    "Importing the legacy 'aws-sdk' v2 significantly increases serverless bundle size.",
    'Use modular AWS SDK v3 clients.',
  ],
  firebase: [
    "Importing the full 'firebase' client bundle increases serverless cold starts.",
    'Use firebase-admin or modular imports on the server.',
  ],
  moment: [
    "Importing 'moment' adds a large non-tree-shakeable dependency.",
    'Use Intl, date-fns, dayjs, or Luxon.',
  ],
};

export function scanColdStart(content: string, file = 'route.ts'): ScanResult {
  const findings: ScannerFinding[] = [];
  let ast: AstNode;
  try {
    ast = parseCode(content);
  } catch {
    return result(findings);
  }
  walk(ast, (node) => {
    if (node.type !== 'ImportDeclaration') return;
    const source = String((node.source as { value?: unknown } | undefined)?.value ?? '');
    const details = heavyImports[source];
    if (details)
      findings.push({
        ruleId: 'cold-start-optimization',
        severity: 'warning',
        file,
        line: lineOf(node),
        message: details[0],
        suggestion: details[1],
      });
  });
  return result(findings);
}

export function scanEdgeRuntime(content: string, file = 'route.ts'): ScanResult {
  const findings: ScannerFinding[] = [];
  let ast: AstNode;
  try {
    ast = parseCode(content);
  } catch {
    return result(findings);
  }
  let edgeRuntime = false;
  const imports: Array<{ source: string; line?: number }> = [];
  walk(ast, (node) => {
    if (node.type === 'ImportDeclaration') {
      imports.push({
        source: String((node.source as { value?: unknown } | undefined)?.value ?? ''),
        line: lineOf(node),
      });
    }
    if (node.type !== 'VariableDeclarator') return;
    const id = node.id as { type?: string; name?: string } | undefined;
    const init = node.init as { type?: string; value?: unknown } | undefined;
    if (
      id?.type === 'Identifier' &&
      id.name === 'runtime' &&
      init?.type === 'StringLiteral' &&
      init.value === 'edge'
    )
      edgeRuntime = true;
  });
  if (!edgeRuntime) return result(findings);
  const forbidden = new Set([
    'fs',
    'node:fs',
    'path',
    'node:path',
    'child_process',
    'node:child_process',
    'os',
    'node:os',
  ]);
  for (const imported of imports) {
    if (forbidden.has(imported.source))
      findings.push({
        ruleId: 'vercel-edge-compatibility',
        severity: 'error',
        file,
        line: imported.line,
        message: `File '${file}' is configured to run on the Edge Runtime, but imports incompatible Node.js core module '${imported.source}'.`,
        suggestion: 'Remove the Edge Runtime configuration or use web-standard APIs.',
      });
  }
  return result(findings);
}

export function scanSqlMigrations(sources: readonly SourceInput[]): ScanResult {
  const findings: ScannerFinding[] = [];
  const created = new Map<string, { file: string; line: number }>();
  const rls = new Set<string>();
  const normalize = (name: string) =>
    name
      .replace(/['"`]/g, '')
      .replace(/^public\./i, '')
      .trim();
  for (const source of sources) {
    source.content.split(/\r?\n/).forEach((line, index) => {
      const code = line.replace(/--.*$/, '');
      const create = code.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_."`'-]+)/i);
      const enabled = code.match(
        /alter\s+table\s+([a-zA-Z0-9_."`'-]+)\s+enable\s+row\s+level\s+security/i,
      );
      if (create) created.set(normalize(create[1]), { file: source.file, line: index + 1 });
      if (enabled) rls.add(normalize(enabled[1]));
      if (
        /alter\s+table[\s\S]*\sadd\s+(?:column\s+)?[\s\S]*\snot\s+null/i.test(code) &&
        !/\bdefault\b/i.test(code)
      ) {
        findings.push({
          ruleId: 'database-migration-safety',
          severity: 'error',
          file: source.file,
          line: index + 1,
          message:
            'Dangerous Migration: adding a NOT NULL column without a DEFAULT can fail on populated tables.',
          suggestion:
            'Add a safe default or backfill the nullable column before applying NOT NULL.',
        });
      }
    });
  }
  for (const [table, location] of created) {
    if (
      !rls.has(table) &&
      !['spatial_ref_sys', 'geography_columns', 'geometry_columns'].includes(table)
    )
      findings.push({
        ruleId: 'supabase-rls',
        severity: 'error',
        file: location.file,
        line: location.line,
        message: `Supabase table '${table}' is created but Row-Level Security (RLS) is not enabled.`,
        suggestion: `Add SQL step: ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`,
      });
  }
  return result(findings);
}

export function scanSqlMigration(content: string, file = 'schema.sql'): ScanResult {
  return scanSqlMigrations([{ file, content }]);
}

export function scanSupabaseClientLeaks(content: string, file = 'component.tsx'): ScanResult {
  const findings: ScannerFinding[] = [];
  let ast: AstNode;
  try {
    ast = parseCode(content);
  } catch {
    return result(findings);
  }
  const program = ast.program as { directives?: Array<{ value?: { value?: string } }> } | undefined;
  const isClient =
    program?.directives?.some((directive) => directive.value?.value === 'use client') ?? false;
  if (!isClient) return result(findings);
  let exposed = false;
  let exposedLine: number | undefined;
  walk(ast, (node) => {
    if (node.type === 'Identifier' && node.name === 'SUPABASE_SERVICE_ROLE_KEY') {
      exposed = true;
      exposedLine ??= lineOf(node);
    }
    if (
      node.type === 'StringLiteral' &&
      /^NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY$/.test(String(node.value))
    ) {
      exposed = true;
      exposedLine ??= lineOf(node);
    }
  });
  if (exposed)
    findings.push({
      ruleId: 'supabase-service-role-leak',
      severity: 'error',
      file,
      line: exposedLine,
      message: 'Potential service_role key leakage in a Client Component.',
      suggestion: 'Move service-role operations to authenticated server-only code.',
    });
  return result(findings);
}

const FRAMEWORK_ENV_KEYS = new Set([
  'NODE_ENV',
  'CI',
  'VERCEL',
  'VERCEL_ENV',
  'NEXT_RUNTIME',
  'PORT',
]);

/** Fallback names documented via their public NEXT_PUBLIC_* counterpart. */
const DOCUMENTED_ENV_ALIASES: Record<string, readonly string[]> = {
  SUPABASE_URL: ['NEXT_PUBLIC_SUPABASE_URL'],
  SUPABASE_ANON_KEY: ['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
};

function isEnvKeyDocumented(key: string, keys: Set<string>): boolean {
  if (keys.has(key)) return true;
  const aliases = DOCUMENTED_ENV_ALIASES[key];
  return aliases?.some((alias) => keys.has(alias)) ?? false;
}

function isTestOrFixturePath(filePath: string): boolean {
  if (!isScannableFile(filePath)) return true;
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return (
    normalized.includes('/testing/') ||
    normalized.includes('/__mocks__/') ||
    normalized.endsWith('playwright.config.ts')
  );
}

export interface ScanEnvOptions {
  /** All `.env.example` files in the repo; nearest ancestor wins for `codeFile`. */
  allExamples?: readonly SourceInput[];
  /** Keys referenced only from test/fixture files — never flagged as undocumented. */
  testOnlyKeys?: ReadonlySet<string>;
}

function parseExampleKeys(content: string): Set<string> {
  const keys = new Set<string>();
  content.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const key = line.split('=')[0]?.trim();
    if (key) keys.add(key);
  });
  return keys;
}

/** Resolve the nearest `.env.example` ancestor for a code path within a monorepo. */
export function resolveEnvExampleForPath(
  codePath: string,
  examples: readonly SourceInput[],
): SourceInput | null {
  const normalizedCode = codePath.replace(/\\/g, '/');
  const codeDir = normalizedCode.includes('/')
    ? normalizedCode.slice(0, normalizedCode.lastIndexOf('/'))
    : '';

  let best: SourceInput | null = null;
  let bestDirLength = -1;

  for (const example of examples) {
    const examplePath = example.file.replace(/\\/g, '/');
    if (!examplePath.endsWith('.env.example')) continue;

    const exampleDir = examplePath.includes('/')
      ? examplePath.slice(0, examplePath.lastIndexOf('/'))
      : '';

    const isAncestor =
      exampleDir === '' ||
      codeDir === exampleDir ||
      (exampleDir.length > 0 && codeDir.startsWith(`${exampleDir}/`));

    if (isAncestor && exampleDir.length >= bestDirLength) {
      best = example;
      bestDirLength = exampleDir.length;
    }
  }

  return best;
}

/** Collect env keys that appear exclusively in non-scannable (test/fixture) files. */
export function collectTestOnlyEnvKeys(sources: readonly SourceInput[]): Set<string> {
  const prodKeys = new Set<string>();
  const testKeys = new Set<string>();

  for (const source of sources) {
    const isTestFile = isTestOrFixturePath(source.file);
    for (const match of source.content.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      const key = match[1];
      if (isTestFile) testKeys.add(key);
      else prodKeys.add(key);
    }
  }

  const testOnly = new Set<string>();
  for (const key of testKeys) {
    if (!prodKeys.has(key)) testOnly.add(key);
  }
  return testOnly;
}

function scanExampleFileSecrets(
  exampleContent: string,
  exampleFile: string,
  findings: ScannerFinding[],
): void {
  exampleContent.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const key = line.split('=')[0]?.trim();
    if (/^NEXT_PUBLIC_(?:SUPABASE_SERVICE_ROLE_KEY|STRIPE_(?:SECRET_KEY|SK))\s*=/.test(line))
      findings.push({
        ruleId: 'public-secret',
        severity: 'error',
        file: exampleFile,
        line: index + 1,
        message: `'${key}' exposes a server secret to the browser.`,
        suggestion: 'Remove NEXT_PUBLIC_ and access the variable only in server-side code.',
      });
    const secret = line.match(/sk_(?:live|test)_[a-zA-Z0-9]{24,}/);
    if (secret)
      findings.push({
        ruleId: 'stripe-secret-leak',
        severity: 'error',
        file: exampleFile,
        line: index + 1,
        message: `CRITICAL KEY LEAK: Hardcoded Stripe secret key found (${secret[0].slice(0, 7)}...).`,
        suggestion: 'Use an empty example value and rotate the exposed key.',
      });
  });
}

export function scanEnvVariables(
  exampleContent: string,
  codeContent: string,
  exampleFile = '.env.example',
  codeFile = 'code.ts',
  options: ScanEnvOptions = {},
): ScanResult {
  const findings: ScannerFinding[] = [];
  const resolvedExample =
    options.allExamples && options.allExamples.length > 0
      ? resolveEnvExampleForPath(codeFile, options.allExamples)
      : null;

  const activeExample = resolvedExample ?? { file: exampleFile, content: exampleContent };
  const keys = parseExampleKeys(activeExample.content);

  if (options.allExamples && options.allExamples.length > 0) {
    const scannedExampleFiles = new Set<string>();
    for (const example of options.allExamples) {
      if (!example.file.endsWith('.env.example') || scannedExampleFiles.has(example.file)) {
        continue;
      }
      scannedExampleFiles.add(example.file);
      scanExampleFileSecrets(example.content, example.file, findings);
    }
  } else {
    scanExampleFileSecrets(exampleContent, exampleFile, findings);
  }

  codeContent.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      const key = match[1];
      if (FRAMEWORK_ENV_KEYS.has(key)) continue;
      if (options.testOnlyKeys?.has(key)) continue;
      if (!isEnvKeyDocumented(key, keys)) {
        const docPath = activeExample.file;
        findings.push({
          ruleId: 'undocumented-env',
          severity: 'error',
          file: codeFile,
          line: index + 1,
          message: `Environment variable 'process.env.${key}' is used but not documented in '${docPath}'.`,
          suggestion: `Add ${key}= to ${docPath}.`,
        });
      }
    }
  });
  return result(findings);
}

export {
  buildScanScope,
  formatScanScopeSummary,
  getFileRelevanceScore,
  inferScanRoots,
  isScannableFile,
  rankFilesByRelevance,
  type ScanScope,
};

export {
  buildIssueGroups,
  buildShipGateReport,
  formatShipGateMarkdown,
  formatShipGatePlainText,
  getFindingGroupKey,
  isShipGateBlocked,
  resolveGroupAction,
  type ShipGateAction,
  type ShipGateActionKind,
  type ShipGateFindingInput,
  type ShipGateGroup,
  type ShipGateMarkdownOptions,
  type ShipGateOptions,
  type ShipGateReport,
  type ShipGateStatus,
} from './shipGate';
