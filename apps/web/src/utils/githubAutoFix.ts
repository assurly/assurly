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

// Assurly scans source files statically — it needs neither the project's
// dependencies installed nor a lockfile, so the workflow does not run `npm ci`
// (which would fail on repos whose package.json lives in a subdirectory) and
// omits setup-node's `cache: 'npm'` (which itself requires a root lockfile).
const ASSURLY_WORKFLOW_TEMPLATE = `name: Assurly Security & Config Scan

on:
  push:
    branches: [ main, master, develop ]
  pull_request:
    branches: [ main, master, develop ]

jobs:
  scan:
    name: Assurly Static Analysis
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Run Assurly Scan
        run: npx --yes assurly@1 scan
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

/**
 * Resolves the migration file an RLS fix is written to. RLS must be enabled in a
 * NEW migration rather than appended to an already-applied one: migration
 * runners do not re-run a modified historical file, so appending would never
 * reach a live database. The name uses a 14-digit `99999999999999` prefix, which
 * string-sorts after both zero-padded sequential names (`001_`, `002_`, …) and
 * timestamp names (`YYYYMMDDHHMMSS_…`), so it always runs after the schema it
 * secures. The name is fixed so re-running the fix updates one file instead of
 * creating duplicates.
 */
export function resolveRlsMigrationTarget(findingFilePath: string): string {
  const normalized = findingFilePath.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  const directory = slash >= 0 ? normalized.slice(0, slash) : '';
  const extension = normalized.toLowerCase().endsWith('.up.sql') ? '.up.sql' : '.sql';
  const fileName = `99999999999999_assurly_enable_rls${extension}`;
  return directory ? `${directory}/${fileName}` : fileName;
}

/**
 * Builds the SQL for one table: enable RLS plus a commented policy scaffold.
 * Enabling RLS without a policy denies all access through the anon/authenticated
 * roles, so the scaffold and warning make that explicit. The example policy is
 * commented and deliberately incomplete (empty USING) so it cannot be applied
 * blindly — the user must fill in their own row-ownership condition.
 */
function buildRlsStatement(tableName: string, quotedTableName: string): string {
  const lastSegment = tableName.includes('.')
    ? tableName.slice(tableName.lastIndexOf('.') + 1)
    : tableName;
  const policyName = `"assurly_${lastSegment.replaceAll('"', '""')}"`;
  return [
    `-- Assurly: enable Row-Level Security on ${quotedTableName}. With RLS on and no`,
    `-- policy, every query through the anon/authenticated roles returns zero rows —`,
    `-- add a policy for your tenancy model before you deploy.`,
    `ALTER TABLE ${quotedTableName} ENABLE ROW LEVEL SECURITY;`,
    `-- TODO(assurly): complete and uncomment a policy that scopes rows to the caller:`,
    `-- CREATE POLICY ${policyName} ON ${quotedTableName}`,
    `--   FOR ALL USING ( /* e.g. organization_id = auth.jwt() ->> 'org_id' */ );`,
  ].join('\n');
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
  return lowerMessage.includes('github actions workflow') && lowerMessage.includes('assurly');
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
      statement: buildRlsStatement(tableName, quotedTableName),
      description: `Enable Row-Level Security (RLS) on table \`${tableName}\` (with a policy scaffold to complete).`,
      title: `security(rls): enable row level security on ${tableName}`,
      targetFilePath: resolveRlsMigrationTarget(filePath),
      applyMode: 'append',
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
      statement: ASSURLY_WORKFLOW_TEMPLATE,
      description: 'Add the Assurly GitHub Actions workflow at `.github/workflows/assurly.yml`.',
      title: 'ci(assurly): add security scan workflow',
      targetFilePath: '.github/workflows/assurly.yml',
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

/** A single repository file together with the ordered fixes that target it. */
export interface GitHubAutoFixFileGroup {
  filePath: string;
  fixes: GitHubAutoFix[];
}

/** High-level metadata for the combined pull request produced from a plan. */
export interface GitHubAutoFixPlanSummary {
  prTitle: string;
  prDescription: string;
}

/**
 * Groups allowlisted fixes by their resolved target file so multiple findings
 * spread across several files can be committed into a single pull request.
 * Returns `null` when any finding cannot be turned into a safe fix.
 */
export function buildGitHubAutoFixPlan(
  findings: readonly AutoFixFindingInput[],
): GitHubAutoFixFileGroup[] | null {
  if (findings.length === 0) return null;

  const groups = new Map<string, GitHubAutoFix[]>();
  const order: string[] = [];

  for (const finding of findings) {
    const fix = buildGitHubAutoFix(finding.file_path, finding.message, finding.rule_id);
    if (!fix) return null;

    const targetPath = fix.targetFilePath ?? finding.file_path;
    let bucket = groups.get(targetPath);
    if (!bucket) {
      bucket = [];
      groups.set(targetPath, bucket);
      order.push(targetPath);
    }
    if (!bucket.some((existing) => existing.statement === fix.statement)) {
      bucket.push(fix);
    }
  }

  const plan: GitHubAutoFixFileGroup[] = [];
  for (const filePath of order) {
    const fixes = groups.get(filePath);
    if (fixes && fixes.length > 0) plan.push({ filePath, fixes });
  }

  return plan.length > 0 ? plan : null;
}

/**
 * Resolves the repository file that a finding's fix targets, matching how
 * {@link buildGitHubAutoFixPlan} groups fixes. Falls back to the finding's own
 * path when the fix does not redirect to another file.
 */
export function resolveFindingAutoFixTargetPath(finding: AutoFixFindingInput): string {
  let fix: GitHubAutoFix | null = null;
  try {
    fix = buildGitHubAutoFix(finding.file_path, finding.message, finding.rule_id);
  } catch {
    return finding.file_path;
  }
  return fix?.targetFilePath ?? finding.file_path;
}

/** Builds a per-file commit message for a group of fixes. */
export function autoFixGroupCommitMessage(group: GitHubAutoFixFileGroup): string {
  const [first] = group.fixes;
  if (group.fixes.length === 1 && first) return first.title;
  return `fix(assurly): apply ${group.fixes.length} automated fixes to ${group.filePath}`;
}

/** Builds the title and description for the combined pull request. */
export function summarizeAutoFixPlan(
  plan: readonly GitHubAutoFixFileGroup[],
): GitHubAutoFixPlanSummary {
  const fixCount = plan.reduce((total, group) => total + group.fixes.length, 0);
  const fileCount = plan.length;
  const prTitle = `fix(assurly): apply ${fixCount} automated ${fixCount === 1 ? 'fix' : 'fixes'}`;

  const details = plan
    .map((group) => {
      const bullets = group.fixes.map((fix) => `  - ${fix.description}`).join('\n');
      return `- \`${group.filePath}\`\n${bullets}`;
    })
    .join('\n');

  const prDescription = [
    `Assurly grouped ${fixCount} automated ${fixCount === 1 ? 'fix' : 'fixes'} across ${fileCount} ${
      fileCount === 1 ? 'file' : 'files'
    } into a single pull request.`,
    '',
    details,
    '',
    'Applied automatically by Assurly.',
  ].join('\n');

  return { prTitle, prDescription };
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
