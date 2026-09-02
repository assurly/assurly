import { parse } from '@babel/parser';
import type { Node } from '@babel/types';
import {
  INSTANT_GATE_MAX_FILES,
  buildScanScope,
  formatScanScopeSummary,
  getFileRelevanceScore,
  inferScanRoots,
  instantGateSurfaceFiles,
  isScannableFile,
  isTextScanSurface,
  measureScanScopeTotals,
  rankFilesByRelevance,
  type BuildScanScopeOptions,
  type ScanScope,
  type ScanScopeGaps,
  type ScanScopeTotals,
} from './fileRelevance';
import { scanRouteHandlerAuth, scanServerActionAuth, scanServiceRoleBypass } from './authBoundary';
import { isPostgresSqlSource } from './sqlDialect';
import { scanSupabaseDeepPolicies } from './supabasePolicies';
import {
  scanStripeLiveKeyInDev,
  scanStripeMissingSubscriptionEvents,
  scanStripeWebhookIdempotencyForProject,
} from './stripeLifecycle';
import { ASSURLY_CANARY_ENV_KEY, isAssurlyCanaryPlantLine } from './canaryToken';

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

export const RLS_SUPABASE_TABLE_LABEL = 'Supabase table';
export const RLS_GENERIC_TABLE_LABEL = 'Database table';

function tableNameFromRlsMessage(message: string): string | null {
  const match = message.match(/table '([^']+)'/i);
  return match?.[1] ?? null;
}

/** True when a `supabase-rls` message was emitted for a real Supabase stack. */
export function isSupabaseRlsMessage(message: string): boolean {
  return message.startsWith(`${RLS_SUPABASE_TABLE_LABEL} '`);
}

/**
 * When both `supabase-rls` and `supabase-migration-auth-linked-no-rls` fire for
 * the same table, keep the richer auth-linked finding and drop the generic one.
 */
export function subsumeRlsFindings(findings: readonly ScannerFinding[]): ScannerFinding[] {
  const authLinkedTables = new Set(
    findings
      .filter((finding) => finding.ruleId === 'supabase-migration-auth-linked-no-rls')
      .map((finding) => tableNameFromRlsMessage(finding.message))
      .filter((table): table is string => Boolean(table)),
  );
  if (authLinkedTables.size === 0) return [...findings];

  return findings.filter((finding) => {
    if (finding.ruleId !== 'supabase-rls') return true;
    const table = tableNameFromRlsMessage(finding.message);
    return !table || !authLinkedTables.has(table);
  });
}

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

/**
 * @param options.eligibleTotal Eligible files across the repository, measured on
 *   the full tree. The browser selects from a sample the server already capped,
 *   so `selection.total` describes that sample — and when the sample was read
 *   whole, `selection.complete` reports a truncated scan as complete.
 */
export function incompleteScanFinding(
  selection: FileSelection<unknown>,
  options: { eligibleTotal?: number } = {},
): ScannerFinding | null {
  const analyzed = selection.files.length;
  const eligible = Math.max(options.eligibleTotal ?? selection.total, analyzed);
  if (eligible <= analyzed) return null;

  return {
    ruleId: 'scan-completeness',
    severity: 'warning',
    message: `Scan is incomplete: analyzed ${analyzed} of ${eligible} eligible files (configured limit: ${selection.limit}).`,
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

function walkWithAncestors(
  node: unknown,
  ancestors: readonly AstNode[],
  visit: (node: AstNode, ancestors: readonly AstNode[]) => void,
): void {
  if (!node || typeof node !== 'object') return;
  const candidate = node as Record<string, unknown>;
  const isAst = typeof candidate.type === 'string';
  const nextAncestors = isAst ? [...ancestors, candidate as AstNode] : ancestors;
  if (isAst) visit(candidate as AstNode, ancestors);
  for (const [key, value] of Object.entries(candidate)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra') continue;
    if (Array.isArray(value)) {
      value.forEach((item) => walkWithAncestors(item, nextAncestors, visit));
    } else if (value && typeof value === 'object') {
      walkWithAncestors(value, nextAncestors, visit);
    }
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
    if (isClient && node.type === 'ImportDeclaration' && node.importKind !== 'type') {
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

const DB_POOL_CLASSES = new Set(['PrismaClient', 'Pool', 'Client', 'MongoClient']);

/** Next.js API route / Route Handler paths, including monorepo apps/<pkg>/src/app/api. */
export function isServerlessApiRouteFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return (
    /(?:^|\/)(?:src\/)?(?:app|pages)\/api\//.test(normalized) &&
    /\.(?:js|ts|jsx|tsx)$/.test(normalized)
  );
}

function enclosingFunctionName(ancestors: readonly AstNode[]): string | null {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const node = ancestors[index];
    if (!node) continue;
    switch (node.type) {
      case 'FunctionDeclaration': {
        const id = node.id as { name?: string } | undefined;
        return id?.name ?? 'anonymous function';
      }
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        const parent = ancestors[index - 1];
        if (parent?.type === 'VariableDeclarator') {
          const id = parent.id as { name?: string } | undefined;
          if (id?.name) return id.name;
        }
        return 'anonymous function';
      }
      case 'ClassMethod':
      case 'ClassPrivateMethod':
      case 'ObjectMethod': {
        const key = node.key as { name?: string; value?: string } | undefined;
        return key?.name ?? (typeof key?.value === 'string' ? key.value : 'anonymous function');
      }
      default:
        break;
    }
  }
  return null;
}

export function scanDbConnectionPooling(content: string, file = 'route.ts'): ScanResult {
  if (!isServerlessApiRouteFile(file)) return result([]);
  const findings: ScannerFinding[] = [];
  let ast: AstNode;
  try {
    ast = parseCode(content);
  } catch {
    return result(findings);
  }
  walkWithAncestors(ast, [], (node, ancestors) => {
    if (node.type !== 'NewExpression') return;
    const callee = node.callee as AstNode | undefined;
    const className = callee?.type === 'Identifier' ? String(callee.name) : null;
    if (!className || !DB_POOL_CLASSES.has(className)) return;
    const functionName = enclosingFunctionName(ancestors);
    if (!functionName) return;
    findings.push({
      ruleId: 'database-connection-pooling',
      severity: 'error',
      confidence: 'high',
      file,
      line: lineOf(node),
      message: `Database client '${className}' is instantiated inside function '${functionName}' in a serverless API route. This will open a new database connection on every request and quickly exhaust your database connection pool.`,
      suggestion: `Move 'new ${className}()' outside the function scope (as a global singleton) or import it from a shared database helper file.`,
    });
  });
  return result(findings);
}

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

const EDGE_FORBIDDEN_IMPORTS = new Set([
  'fs',
  'node:fs',
  'fs/promises',
  'node:fs/promises',
  'path',
  'node:path',
  'child_process',
  'node:child_process',
  'os',
  'node:os',
  'net',
  'node:net',
  'dns',
  'node:dns',
  'tls',
  'node:tls',
  'worker_threads',
  'node:worker_threads',
  '@prisma/client',
  'pg',
  'mysql2',
  'mongodb',
  'mongoose',
  'redis',
  'sequelize',
  'sharp',
  'bcrypt',
  'bcryptjs',
]);

function declaresEdgeRuntime(content: string, ast: AstNode): boolean {
  let edgeRuntime = false;
  walk(ast, (node) => {
    if (node.type !== 'ExportNamedDeclaration' && node.type !== 'VariableDeclarator') return;
    const declarator =
      node.type === 'ExportNamedDeclaration'
        ? (node.declaration as AstNode | undefined)?.type === 'VariableDeclaration'
          ? ((node.declaration as AstNode).declarations as AstNode[] | undefined)?.[0]
          : undefined
        : node;
    if (!declarator || declarator.type !== 'VariableDeclarator') return;
    const id = declarator.id as { type?: string; name?: string } | undefined;
    const init = declarator.init as { type?: string; value?: unknown } | undefined;
    if (
      id?.type === 'Identifier' &&
      id.name === 'runtime' &&
      init?.type === 'StringLiteral' &&
      init.value === 'edge'
    ) {
      edgeRuntime = true;
    }
  });
  return edgeRuntime || /export\s+const\s+runtime\s*=\s*['"]edge['"]/.test(content);
}

export function scanEdgeRuntime(content: string, file = 'route.ts'): ScanResult {
  const findings: ScannerFinding[] = [];
  let ast: AstNode;
  try {
    ast = parseCode(content);
  } catch {
    return result(findings);
  }
  if (!declaresEdgeRuntime(content, ast)) return result(findings);

  const imports: Array<{ source: string; line?: number }> = [];
  walk(ast, (node) => {
    if (node.type === 'ImportDeclaration') {
      imports.push({
        source: String((node.source as { value?: unknown } | undefined)?.value ?? ''),
        line: lineOf(node),
      });
    }
  });

  for (const imported of imports) {
    const source = imported.source;
    if (
      EDGE_FORBIDDEN_IMPORTS.has(source) ||
      [...EDGE_FORBIDDEN_IMPORTS].some((pkg) => source.startsWith(`${pkg}/`) || source === pkg)
    ) {
      findings.push({
        ruleId: 'vercel-edge-node-mismatch',
        severity: 'error',
        confidence: 'high',
        file,
        line: imported.line,
        message: `File '${file}' declares Edge Runtime but imports Node-only module '${source}'.`,
        suggestion:
          'Remove the Edge Runtime configuration or replace Node-only imports with web-standard APIs.',
      });
    }
  }
  return result(findings);
}

const LONG_RUNNING_ROUTE_PATTERNS = [
  /\bstreamText\s*\(/,
  /\bstreamUI\s*\(/,
  /\$transaction\s*\(/,
  /\bwhile\s*\(\s*true\s*\)/,
  /\bsetTimeout\s*\(\s*[^,]+,\s*(?:[5-9]\d{3}|\d{5,})\s*\)/,
  /\.webhooks\.constructEvent(?:Async)?\s*\(/,
  /\bprisma\.[a-zA-Z_$]+\.(?:createMany|updateMany|deleteMany)\s*\(/,
];

function isRouteHandlerPath(file: string): boolean {
  const normalized = file.replace(/\\/g, '/').toLowerCase();
  return (
    normalized.endsWith('/route.ts') ||
    normalized.endsWith('/route.js') ||
    normalized.endsWith('/route.tsx') ||
    normalized.endsWith('/route.jsx') ||
    normalized.includes('/api/')
  );
}

export function scanMaxDuration(content: string, file = 'route.ts'): ScanResult {
  const findings: ScannerFinding[] = [];
  if (!isRouteHandlerPath(file)) return result(findings);
  if (/\bmaxDuration\b/.test(content)) return result(findings);

  const longRunningSignals = LONG_RUNNING_ROUTE_PATTERNS.filter((pattern) => pattern.test(content));
  if (longRunningSignals.length === 0) return result(findings);

  return result([
    {
      ruleId: 'vercel-maxduration-missing',
      severity: 'warning',
      confidence: 'low',
      file,
      line: 1,
      message:
        'Route handler looks long-running but does not export maxDuration for Vercel serverless limits.',
      suggestion:
        'Export maxDuration (seconds) on routes that stream, run transactions, or process webhooks.',
    },
  ]);
}

export function scanSqlMigrations(sources: readonly SourceInput[]): ScanResult {
  const findings: ScannerFinding[] = [];
  const created = new Map<string, { file: string; line: number }>();
  const rls = new Set<string>();
  const postgresSources = sources.filter((source) => isPostgresSqlSource(source));
  const normalize = (name: string) =>
    name
      .replace(/['"`]/g, '')
      .replace(/^public\./i, '')
      .trim();
  for (const source of postgresSources) {
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
  const hasSupabaseSignal = postgresSources.some(
    (source) =>
      /supabase/i.test(source.file) ||
      /supabase/i.test(source.content) ||
      /auth\.uid\(\)/i.test(source.content) ||
      /auth\.users\b/i.test(source.content),
  );
  const tableLabel = hasSupabaseSignal ? RLS_SUPABASE_TABLE_LABEL : RLS_GENERIC_TABLE_LABEL;
  for (const [table, location] of created) {
    if (
      !rls.has(table) &&
      !['spatial_ref_sys', 'geography_columns', 'geometry_columns'].includes(table)
    )
      findings.push({
        ruleId: 'supabase-rls',
        severity: hasSupabaseSignal ? 'error' : 'warning',
        confidence: hasSupabaseSignal ? 'high' : 'medium',
        file: location.file,
        line: location.line,
        message: `${tableLabel} '${table}' is created but Row-Level Security (RLS) is not enabled.`,
        suggestion: `Add SQL step: ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`,
      });
  }

  findings.push(...scanSupabaseDeepPolicies(postgresSources).findings);
  return result(subsumeRlsFindings(findings));
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
  // GitHub Actions / runner injected variables — not project secrets to document.
  'GITHUB_OUTPUT',
  'GITHUB_STEP_SUMMARY',
  'GITHUB_ENV',
  'GITHUB_PATH',
  'GITHUB_ACTION',
  'GITHUB_ACTIONS',
  'GITHUB_WORKSPACE',
  'GITHUB_EVENT_PATH',
  'GITHUB_EVENT_NAME',
  'GITHUB_RUN_ID',
  'GITHUB_RUN_NUMBER',
  'GITHUB_SHA',
  'GITHUB_REF',
  'GITHUB_REPOSITORY',
  'GITHUB_JOB',
  'GITHUB_WORKFLOW',
  'RUNNER_OS',
  'RUNNER_ARCH',
  'RUNNER_TEMP',
  'RUNNER_TOOL_CACHE',
  ASSURLY_CANARY_ENV_KEY,
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

/**
 * CLI env-docs surface: application source, not tooling packages (`packages/cli`).
 * Matches `packages/cli/src/rules/envRules.ts` path prefixes exactly.
 */
export function isAppEnvSourceFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  if (!/\.(?:js|ts|jsx|tsx)$/.test(normalized)) return false;
  return (
    normalized.startsWith('src/') ||
    normalized.startsWith('app/') ||
    normalized.startsWith('apps/') ||
    normalized.startsWith('pages/') ||
    normalized.startsWith('components/')
  );
}

function processEnvKeyFromNode(node: AstNode): string | null {
  if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return null;
  const object = node.object as AstNode | undefined;
  if (
    !object ||
    (object.type !== 'MemberExpression' && object.type !== 'OptionalMemberExpression')
  ) {
    return null;
  }
  const processId = object.object as AstNode | undefined;
  if (processId?.type !== 'Identifier' || processId.name !== 'process') return null;
  if (memberName(object) !== 'env') return null;
  const key = memberName(node);
  if (!key || !/^[A-Z0-9_]+$/.test(key)) return null;
  return key;
}

function stripQuotedSpans(line: string): string {
  return line.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, ' ');
}

/**
 * `process.env.KEY` / `process.env['KEY']` from real code, never from string literals.
 */
export function collectProcessEnvKeysFromCode(
  content: string,
): Array<{ key: string; line: number }> {
  try {
    const ast = parseCode(content);
    const found: Array<{ key: string; line: number }> = [];
    walk(ast, (node) => {
      const key = processEnvKeyFromNode(node);
      if (key) found.push({ key, line: lineOf(node) ?? 1 });
    });
    return found;
  } catch {
    const found: Array<{ key: string; line: number }> = [];
    content.split(/\r?\n/).forEach((line, index) => {
      const searchable = stripQuotedSpans(line);
      for (const match of searchable.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        found.push({ key: match[1], line: index + 1 });
      }
    });
    return found;
  }
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
  /**
   * When false, skip the one-per-scan `assurly-canary-missing` warning.
   * Callers that invoke `scanEnvVariables` in a loop should emit it once.
   */
  emitMissingCanary?: boolean;
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

/**
 * Propose the package-local `.env.example` path for a code file when no ancestor
 * example exists. Preserves leading workspace prefixes (e.g. `shipready/`).
 */
export function proposeEnvExamplePath(codePath: string): string {
  const normalized = codePath.replace(/\\/g, '/');
  const packageMatch = normalized.match(/^((?:.*\/)?(?:apps|packages)\/[^/]+)\//);
  if (packageMatch?.[1]) {
    return `${packageMatch[1]}/.env.example`;
  }
  return '.env.example';
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
    for (const { key } of collectProcessEnvKeysFromCode(source.content)) {
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

    // Planted Assurly canaries are intentional — informational, never a leak.
    if (isAssurlyCanaryPlantLine(line)) {
      findings.push({
        ruleId: 'assurly-canary-planted',
        severity: 'warning',
        confidence: 'high',
        file: exampleFile,
        line: index + 1,
        message:
          'Assurly canary token detected. This is an intentional tripwire, not a leaked credential.',
        suggestion:
          'Keep the canary planted. If Assurly alerts on a fetch of this URL, rotate the real Stripe, Supabase, and GitHub secrets on this app — not the canary URL.',
      });
      return;
    }

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

function isEnvExamplePath(filePath: string): boolean {
  return filePath.replace(/\\/g, '/').endsWith('.env.example');
}

function exampleHasCanaryPlant(content: string): boolean {
  return content.split(/\r?\n/).some((line) => isAssurlyCanaryPlantLine(line));
}

/**
 * One warning per scan when at least one `.env.example` exists and none of them
 * plant a silent alarm. Never a blocker — the offline scanner cannot mint a
 * live callback URL.
 */
function pushMissingCanaryFinding(
  examples: readonly SourceInput[],
  findings: ScannerFinding[],
): void {
  const existing = examples.filter(
    (example) => isEnvExamplePath(example.file) && example.content.trim().length > 0,
  );
  if (existing.length === 0) return;
  if (existing.some((example) => exampleHasCanaryPlant(example.content))) return;

  const target =
    existing.find((example) => example.file.replace(/\\/g, '/') === '.env.example') ?? existing[0]!;
  findings.push({
    ruleId: 'assurly-canary-missing',
    severity: 'warning',
    confidence: 'high',
    file: target.file,
    line: 1,
    message:
      'No Assurly silent alarm in .env.example. Plant ASSURLY_CANARY_URL so Assurly can alert if an attacker fetches stolen env.',
    suggestion: 'Add a silent alarm in Assurly (dashboard / MCP plant).',
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
  const hasAllExamples = options.allExamples !== undefined;
  const resolvedExample = hasAllExamples
    ? resolveEnvExampleForPath(codeFile, options.allExamples ?? [])
    : null;

  // When callers pass allExamples (monorepo mode), never fall back to a
  // non-ancestor exampleFile — that steals apps/web/.env.example for packages/*.
  const activeExample = resolvedExample
    ? resolvedExample
    : hasAllExamples
      ? { file: proposeEnvExamplePath(codeFile), content: '' }
      : { file: exampleFile, content: exampleContent };
  const keys = parseExampleKeys(activeExample.content);

  if (hasAllExamples && (options.allExamples?.length ?? 0) > 0) {
    const scannedExampleFiles = new Set<string>();
    for (const example of options.allExamples ?? []) {
      if (!example.file.endsWith('.env.example') || scannedExampleFiles.has(example.file)) {
        continue;
      }
      scannedExampleFiles.add(example.file);
      scanExampleFileSecrets(example.content, example.file, findings);
    }
    if (options.emitMissingCanary !== false) {
      pushMissingCanaryFinding(options.allExamples ?? [], findings);
    }
  } else if (!hasAllExamples) {
    scanExampleFileSecrets(exampleContent, exampleFile, findings);
    if (options.emitMissingCanary !== false) {
      pushMissingCanaryFinding([{ file: exampleFile, content: exampleContent }], findings);
    }
  }

  for (const { key, line } of collectProcessEnvKeysFromCode(codeContent)) {
    if (FRAMEWORK_ENV_KEYS.has(key)) continue;
    if (options.testOnlyKeys?.has(key)) continue;
    if (!isEnvKeyDocumented(key, keys)) {
      const docPath = activeExample.file;
      findings.push({
        ruleId: 'undocumented-env',
        // Hygiene / DX — not a deploy-safety blocker. Missing `.env.example`
        // docs fail the Phase 0 "30-second defend" test for hard blockers.
        severity: 'warning',
        confidence: 'high',
        file: codeFile,
        line,
        message: `Environment variable 'process.env.${key}' is used but not documented in '${docPath}'.`,
        suggestion: `Add ${key}= to ${docPath}.`,
      });
    }
  }
  return result(findings);
}

export {
  INSTANT_GATE_MAX_FILES,
  buildScanScope,
  formatScanScopeSummary,
  getFileRelevanceScore,
  inferScanRoots,
  instantGateSurfaceFiles,
  isScannableFile,
  isTextScanSurface,
  measureScanScopeTotals,
  rankFilesByRelevance,
  type BuildScanScopeOptions,
  type ScanScope,
  type ScanScopeGaps,
  type ScanScopeTotals,
};

export {
  SCAN_LANGUAGE_COVERAGE_RULE_ID,
  UNANALYZED_SOURCE_LANGUAGES,
  formatUnanalyzedLogLine,
  isAnalyzedCodeFile,
  isAnalyzedSourceFile,
  isSecuritySurfacePath,
  summarizeUnanalyzedSource,
  unanalyzedLanguageCounts,
  unanalyzedLanguageForPath,
  unanalyzedSourceFinding,
  type UnanalyzedLanguageCount,
  type UnanalyzedLanguageSummary,
  type UnanalyzedSourceSummary,
} from './languageCoverage';

export {
  MAX_PACKAGE_MANIFESTS,
  describeDetectedStack,
  detectStackFromManifests,
  selectPackageManifestPaths,
  type DetectedDatabase,
  type DetectedDeployment,
  type DetectedFramework,
  type DetectedPayments,
  type DetectedStack,
  type DetectStackFromManifestsInput,
  type PackageManifestInput,
} from './stackDetect';

export {
  scanAiAppSecurity,
  scanAiLlmKeyLeak,
  scanAiPiiToModelContext,
  scanAiPromptInjection,
  scanAiRateLimit,
  scanAiRouteAuthz,
} from './aiAppSecurity';

export {
  scanAuthBoundary,
  scanRouteHandlerAuth,
  scanServerActionAuth,
  scanServiceRoleBypass,
} from './authBoundary';

export {
  scanAuthLinkedMigrationNoRls,
  scanSupabaseDeepPolicies,
  scanSupabasePolicies,
  scanSupabaseStorage,
} from './supabasePolicies';

export {
  scanStripeLifecycle,
  scanStripeLiveKeyInDev,
  scanStripeMissingSubscriptionEvents,
  scanStripeWebhookIdempotency,
  scanStripeWebhookIdempotencyForProject,
} from './stripeLifecycle';

export {
  HIGH_CONFIDENCE_BLOCKER_RULE_IDS,
  isHighConfidenceBlockerRuleId,
  type HighConfidenceBlockerRuleId,
} from './blockerAllowlist';

export {
  isAgentInstructionFile,
  isAgentMcpConfigFile,
  isAgentStackFile,
  redactEnvKey,
  scanAgentInstructionFile,
  scanAgentMcpConfig,
  scanAgentStack,
} from './agentStack';

export {
  SUPPLY_ALLOWSCRIPTS_IN_WORKSPACE,
  SUPPLY_ALLOWSCRIPTS_INVALID,
  SUPPLY_ALLOWSCRIPTS_STALE,
  SUPPLY_ALLOWSCRIPTS_UNPINNED,
  SUPPLY_CHAIN_RULE_IDS,
  SUPPLY_INSTALL_SCRIPTS_UNREVIEWED,
  SUPPLY_NON_REGISTRY_DEPENDENCY,
  SUPPLY_NPM_BELOW_V12,
  classifyAllowScriptsKey,
  enginesNpmPermitsBelow12,
  isSupplyChainRuleId,
  packageNameFromLockKey,
  parsePackageManagerNpmMajor,
  readIgnoreScriptsFromNpmrc,
  scanSupplyChain,
  type SupplyChainRuleId,
  type SupplyChainScanInput,
  type SupplyChainScanResult,
  type WorkspacePackageJsonInput,
} from './supplyChain';

export {
  DEP_DEFAULT_EVAL_CAP,
  DEP_LOW_DOWNLOADS,
  DEP_NEW_UNVETTED,
  DEP_NONEXISTENT_PACKAGE,
  DEP_PROXIMITY_MAX_DISTANCE,
  DEP_REGISTRY_UNAVAILABLE,
  DEP_SCAN_CAPPED,
  DEP_SLOPSQUAT_SUSPECT,
  DEP_TYPOSQUAT_SUSPECT,
  DEP_YOUNG_AGE_DAYS,
  collectDependencyNames,
  contiguousTokenRuns,
  diffAddedDependencies,
  evaluateDependencyProvenance,
  evaluateNewDependencies,
  findBorrowedCorpusName,
  getTopNpmPackageCorpus,
  isAbandonedShape,
  parsePackageJsonDependencies,
  scopeOwnsBorrowedName,
  tokenizePackageName,
  type BorrowedNameMatch,
  type DependencyProvenanceScanResult,
  type DependencyProvenanceSignals,
  type PackageJsonDependencies,
} from './dependencyProvenance';

export {
  damerauLevenshtein,
  findNearestCorpusMatch,
  type NearestCorpusMatch,
} from './editDistance';

export {
  ASSURLY_CANARY_CALLBACK_PATH,
  ASSURLY_CANARY_ENV_KEY,
  ASSURLY_CANARY_IN_TEXT,
  ASSURLY_CANARY_PREFIX,
  containsAssurlyCanaryCallbackPath,
  containsAssurlyCanaryToken,
  extractAssurlyCanaryToken,
  isAssurlyCanaryBody,
  isAssurlyCanaryEnvKey,
  isAssurlyCanaryMcpUrl,
  isAssurlyCanaryPlantLine,
  isAssurlyCanaryToken,
  mergeCanaryPlantIntoEnvExample,
} from './canaryToken';

export interface DeeperStackScanOptions {
  /**
   * Whether to run `scanEdgeRuntime`. The CLI and web already wire the edge
   * scanner through their own dedicated paths (vercelRules / DashboardClient),
   * so those callers pass `false` to avoid emitting duplicate edge findings.
   * Defaults to `true` so standalone callers (and the integration test) get the
   * complete deeper-stack rule set.
   */
  includeEdgeRuntime?: boolean;
}

/** Runs Phase 3 deeper-stack scanners over the supplied project sources. */
export function runDeeperStackScans(
  sources: readonly SourceInput[],
  options: DeeperStackScanOptions = {},
): ScanResult {
  const { includeEdgeRuntime = true } = options;
  const findings: ScannerFinding[] = [];
  const sqlSources = sources.filter((source) => source.file.endsWith('.sql'));
  const codeSources = sources.filter((source) => /\.(?:js|ts|jsx|tsx)$/.test(source.file));
  const envSources = sources.filter((source) =>
    /(?:^|[/\\])\.env(?:\.(?:local|development|dev|test|staging))?(?:$|[/\\])/.test(
      source.file.replace(/\\/g, '/'),
    ),
  );

  for (const source of codeSources) {
    findings.push(...scanServerActionAuth(source.content, source.file).findings);
    findings.push(...scanRouteHandlerAuth(source.content, source.file).findings);
    findings.push(...scanServiceRoleBypass(source.content, source.file).findings);
    findings.push(...scanStripeMissingSubscriptionEvents(source.content, source.file).findings);
    if (includeEdgeRuntime) {
      findings.push(...scanEdgeRuntime(source.content, source.file).findings);
    }
    findings.push(...scanMaxDuration(source.content, source.file).findings);
  }

  findings.push(...scanStripeWebhookIdempotencyForProject(codeSources).findings);

  for (const source of envSources) {
    findings.push(...scanStripeLiveKeyInDev(source.content, source.file).findings);
  }

  const postgresSqlSources = sqlSources.filter((source) => isPostgresSqlSource(source));
  if (postgresSqlSources.length > 0) {
    findings.push(...scanSupabaseDeepPolicies(postgresSqlSources).findings);
  }

  return result(findings);
}

export {
  BLOCKED_SCORE_CAP,
  RLS_SCORE_GROUP_CAP,
  buildIssueGroups,
  buildShipGateReport,
  countCleanScannedFiles,
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

export {
  excludeGitIgnoredFiles,
  isAssurlyEnvExamplePath,
  isGitIgnorePath,
  isGitIgnored,
  parseGitIgnoreSources,
  type GitIgnoreFileInput,
  type GitIgnoreSource,
} from './gitIgnore';

export {
  GITHUB_ACTIONS_EXISTING_CI_MESSAGE,
  GITHUB_ACTIONS_INIT_SUGGESTION,
  GITHUB_ACTIONS_MISSING_ASSURLY_MESSAGE,
  githubActionsIntegrationMessage,
  scanGithubActionsIntegration,
  scanHardcodedStripeSecrets,
  scanTsconfigStrict,
  scanWorkspaceFiles,
} from './workspaceScan';

export {
  detectSqlDialect,
  isPostgresSqlSource,
  type SqlDialect,
  type SqlDialectInput,
} from './sqlDialect';
