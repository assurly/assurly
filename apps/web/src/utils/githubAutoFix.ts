export interface GitHubAutoFix {
  statement: string;
  description: string;
  title: string;
  /** When set, the fix commit targets this repository path instead of the finding path. */
  targetFilePath?: string;
  /** How to merge the statement into the target file. Defaults to append. */
  applyMode?: 'append' | 'replace' | 'create';
}

const POSTGRES_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
const ENVIRONMENT_VARIABLE = /^[A-Z_][A-Z0-9_]{0,127}$/;

const SHIPREADY_WORKFLOW_TEMPLATE = `name: ShipReady Security & Config Scan

on:
  push:
    branches: [ main, master, develop ]
  pull_request:
    branches: [ main, master, develop ]

jobs:
  scan:
    name: ShipReady Static Analysis
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install dependencies
        run: npm ci --prefer-offline --no-audit

      - name: Run ShipReady Scan
        run: npx --yes @shipready/cli@1.0.0 scan
`;

function quotePostgresIdentifier(value: string): string {
  const segments = value.split('.');
  if (
    segments.length < 1 ||
    segments.length > 2 ||
    !segments.every((part) => POSTGRES_IDENTIFIER.test(part))
  ) {
    throw new Error('The finding contains an unsafe PostgreSQL identifier.');
  }
  return segments.map((part) => `"${part.replaceAll('"', '""')}"`).join('.');
}

export function resolveEnvExamplePath(sourceFilePath: string): string {
  const normalized = sourceFilePath.replace(/\\/g, '/');
  const appsMatch = normalized.match(/^apps\/[^/]+/);
  if (appsMatch) return `${appsMatch[0]}/.env.example`;
  const packagesMatch = normalized.match(/^packages\/[^/]+/);
  if (packagesMatch) return `${packagesMatch[0]}/.env.example`;
  return '.env.example';
}

export function resolveAutoFixTargetPath(
  findingFilePath: string,
  fix: GitHubAutoFix | null,
): string {
  return fix?.targetFilePath ?? findingFilePath;
}

export function applyAutoFixToFileContent(original: string, fix: GitHubAutoFix): string {
  if (fix.applyMode === 'replace' || fix.applyMode === 'create') {
    const next = fix.statement.endsWith('\n') ? fix.statement : `${fix.statement}\n`;
    if (original === next || original.trim() === next.trim()) return original;
    if (original === fix.statement || original.trim() === fix.statement.trim()) return original;
    return next;
  }

  const envKey = fix.statement.match(/^([A-Z_][A-Z0-9_]*)=/)?.[1];
  if (envKey) {
    const envPattern = new RegExp(`^\\s*${envKey}\\s*=`, 'm');
    if (envPattern.test(original) || original.includes(fix.statement)) return original;
  }

  if (original.includes(fix.statement)) return original;

  return `${original}${original && !original.endsWith('\n') ? '\n' : ''}${fix.statement}\n`;
}

function isUndocumentedEnvMessage(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  return (
    lowerMessage.includes('environment variable') && lowerMessage.includes('not documented in')
  );
}

function isGithubActionsIntegrationFinding(message: string, ruleId?: string): boolean {
  if (ruleId === 'github-actions-integration') return true;
  const lowerMessage = message.toLowerCase();
  return lowerMessage.includes('github actions workflow') && lowerMessage.includes('shipready');
}

export function buildGitHubAutoFix(
  filePath: string,
  message: string,
  ruleId?: string,
): GitHubAutoFix | null {
  const lowerPath = filePath.toLowerCase();
  const lowerMessage = message.toLowerCase();

  if (lowerPath.endsWith('.sql') && lowerMessage.includes('row-level security')) {
    const tableName =
      message.match(/table\s+'([^']+)'/i)?.[1] ?? message.match(/supabase table\s+'([^']+)'/i)?.[1];
    if (!tableName) throw new Error('The finding does not contain a PostgreSQL table name.');
    const quotedTableName = quotePostgresIdentifier(tableName);
    return {
      statement: `ALTER TABLE ${quotedTableName} ENABLE ROW LEVEL SECURITY;`,
      description: `Enable Row-Level Security (RLS) on table \`${tableName}\`.`,
      title: `security(rls): enable row level security on ${tableName}`,
    };
  }

  if (isUndocumentedEnvMessage(message)) {
    const variable = message.match(/variable\s+'process\.env\.([^']+)'/i)?.[1];
    if (!variable || !ENVIRONMENT_VARIABLE.test(variable)) {
      throw new Error('The finding contains an unsafe environment variable name.');
    }
    return {
      statement: `${variable}=`,
      description: `Document environment variable \`${variable}\` in \`.env.example\`.`,
      title: `docs(env): document variable ${variable} in .env.example`,
      targetFilePath: lowerPath.endsWith('.env.example')
        ? filePath
        : resolveEnvExamplePath(filePath),
      applyMode: 'append',
    };
  }

  if (isGithubActionsIntegrationFinding(message, ruleId)) {
    return {
      statement: SHIPREADY_WORKFLOW_TEMPLATE,
      description:
        'Add the ShipReady GitHub Actions workflow at `.github/workflows/shipready.yml`.',
      title: 'ci(shipready): add security scan workflow',
      targetFilePath: '.github/workflows/shipready.yml',
      applyMode: 'create',
    };
  }

  return null;
}

export interface AutoFixFindingInput {
  file_path: string;
  message: string;
  rule_id?: string;
}

/** Combines multiple allowlisted fixes in the same file into one commit/PR. */
export function buildGitHubAutoFixBatch(
  findings: readonly AutoFixFindingInput[],
): GitHubAutoFix | null {
  if (findings.length === 0) return null;

  const filePath = findings[0]?.file_path;
  if (!filePath || !findings.every((finding) => finding.file_path === filePath)) return null;

  const statements: string[] = [];
  const tableNames: string[] = [];

  for (const finding of findings) {
    const fix = buildGitHubAutoFix(finding.file_path, finding.message, finding.rule_id);
    if (!fix) return null;
    if (statements.includes(fix.statement)) continue;
    statements.push(fix.statement);
    const tableName =
      finding.message.match(/table\s+'([^']+)'/i)?.[1] ??
      finding.message.match(/supabase table\s+'([^']+)'/i)?.[1];
    if (tableName) tableNames.push(tableName);
  }

  if (statements.length === 0) return null;

  if (statements.length === 1 && tableNames[0]) {
    return buildGitHubAutoFix(filePath, findings[0]?.message ?? '', findings[0]?.rule_id);
  }

  const tableList = tableNames.map((name) => `\`${name}\``).join(', ');
  return {
    statement: statements.join('\n'),
    description: `Enable Row-Level Security (RLS) on ${tableList}.`,
    title: `security(rls): enable row level security on ${tableNames.length} tables`,
  };
}

export function isAutoFixableFinding(finding: {
  severity: 'error' | 'warning';
  file_path: string;
  message: string;
  rule_id?: string;
}): boolean {
  const filePath = finding.file_path.toLowerCase();
  const message = finding.message.toLowerCase();

  if (finding.rule_id === 'github-actions-integration') return true;
  if (isGithubActionsIntegrationFinding(finding.message, finding.rule_id)) return true;

  if (finding.severity !== 'error') return false;

  const isSqlRls = filePath.endsWith('.sql') && message.includes('row-level security');
  const isUndocumentedEnv = isUndocumentedEnvMessage(finding.message);

  return isSqlRls || isUndocumentedEnv;
}
