import { excludeGitIgnoredFiles } from './gitIgnore';
import { isScannableFile } from './fileRelevance';
import { isAgentStackFile, scanAgentStack } from './agentStack';
import { scanSupplyChain } from './supplyChain';
import {
  collectTestOnlyEnvKeys,
  isAppEnvSourceFile,
  isServerlessApiRouteFile,
  runDeeperStackScans,
  scanColdStart,
  scanDbConnectionPooling,
  scanEdgeRuntime,
  scanEnvVariables,
  scanRscDataLeaks,
  scanSqlMigrations,
  scanStripeWebhook,
  scanSupabaseClientLeaks,
  type ScanResult,
  type ScannerFinding,
  type SourceInput,
} from './index';

const result = (findings: ScannerFinding[]): ScanResult => ({
  errorCount: findings.filter((finding) => finding.severity === 'error').length,
  warningCount: findings.filter((finding) => finding.severity === 'warning').length,
  findings,
});

const STRIPE_SECRET_KEY_PATTERN = /sk_(?:live|test)_[a-zA-Z0-9]{24,}/g;
const WORKFLOW_PATTERN = /^\.github\/workflows\/.*\.(ya?ml)$/i;
const ASSURLY_SCAN_STEP_PATTERN = /assurly|npm\s+run\s+scan(?::self)?|npx\s+assurly\s+scan/i;

export const GITHUB_ACTIONS_MISSING_ASSURLY_MESSAGE =
  'GitHub Actions workflow for Assurly is missing.';
export const GITHUB_ACTIONS_EXISTING_CI_MESSAGE =
  'GitHub Actions workflows exist, but none runs the Assurly scan.';
export const GITHUB_ACTIONS_INIT_SUGGESTION =
  'Run "npx assurly init" to automatically generate the .github/workflows/assurly.yml workflow file.';

export function githubActionsIntegrationMessage(existingWorkflowCount: number): string {
  return existingWorkflowCount > 0
    ? GITHUB_ACTIONS_EXISTING_CI_MESSAGE
    : GITHUB_ACTIONS_MISSING_ASSURLY_MESSAGE;
}

function posixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function findExact(files: readonly SourceInput[], relativePath: string): SourceInput | undefined {
  return files.find((file) => posixPath(file.file) === relativePath);
}

function projectUsesStripe(files: readonly SourceInput[]): boolean {
  return files.some((file) => {
    const path = posixPath(file.file);
    if (/(^|\/)package\.json$/.test(path) && /["']stripe["']\s*:/.test(file.content)) return true;
    if (
      /\.(?:js|ts|jsx|tsx)$/.test(path) &&
      /from\s+['"]stripe['"]|require\(\s*['"]stripe['"]\s*\)/.test(file.content)
    ) {
      return true;
    }
    return false;
  });
}

const WORKSPACE_TSCONFIG = /^(apps|packages)\/[^/]+\/tsconfig\.json$/;

const MISSING_ROOT_TSCONFIG: ScannerFinding = {
  ruleId: 'typescript-strict-mode',
  severity: 'warning',
  message: 'No tsconfig.json file found in project root. TypeScript configuration is missing.',
  suggestion:
    'Create a tsconfig.json in the project root and configure "strict": true in compilerOptions.',
};

function isWorkspacePackageTsconfig(filePath: string): boolean {
  return WORKSPACE_TSCONFIG.test(posixPath(filePath));
}

function evaluateTsconfigStrict(file: SourceInput): ScannerFinding[] {
  try {
    const cleanContent = file.content.replace(
      /("([^"\\]|\\.)*")|(\/\/.*|\/\*[\s\S]*?\*\/)/g,
      (match, quoted: string | undefined) => (quoted ? match : ''),
    );
    const parsed = JSON.parse(cleanContent) as { compilerOptions?: { strict?: boolean } };
    if (parsed.compilerOptions?.strict === true) return [];
    return [
      {
        ruleId: 'typescript-strict-mode',
        severity: 'warning',
        file: file.file,
        message:
          'TypeScript strict mode is disabled or not set. "strict": true is highly recommended for B2B SaaS applications to prevent runtime crashes.',
        suggestion: 'Set "strict": true inside the "compilerOptions" block of your tsconfig.json.',
      },
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      {
        ruleId: 'typescript-strict-mode',
        severity: 'warning',
        file: file.file,
        message: `Failed to parse tsconfig.json: ${message}.`,
        suggestion: 'Verify that tsconfig.json is a valid JSON file (with or without comments).',
      },
    ];
  }
}

export function scanTsconfigStrict(files: readonly SourceInput[]): ScanResult {
  const root = findExact(files, 'tsconfig.json');
  const targets = root ? [root] : files.filter((file) => isWorkspacePackageTsconfig(file.file));
  if (targets.length === 0) return result([MISSING_ROOT_TSCONFIG]);
  return result(targets.flatMap(evaluateTsconfigStrict));
}

export function scanGithubActionsIntegration(files: readonly SourceInput[]): ScanResult {
  const workflows = files.filter((file) => WORKFLOW_PATTERN.test(posixPath(file.file)));
  if (workflows.some((file) => ASSURLY_SCAN_STEP_PATTERN.test(file.content))) {
    return result([]);
  }
  return result([
    {
      ruleId: 'github-actions-integration',
      severity: 'warning',
      message: githubActionsIntegrationMessage(workflows.length),
      suggestion: GITHUB_ACTIONS_INIT_SUGGESTION,
    },
  ]);
}

export function scanHardcodedStripeSecrets(files: readonly SourceInput[]): ScanResult {
  const findings: ScannerFinding[] = [];
  const textFiles = files.filter((file) => {
    const path = posixPath(file.file);
    return /\.(?:js|ts|jsx|tsx|json|ya?ml|md|txt)$/.test(path) && !path.includes('.env');
  });

  for (const file of textFiles) {
    file.content.split(/\r?\n/).forEach((line, index) => {
      STRIPE_SECRET_KEY_PATTERN.lastIndex = 0;
      for (const match of line.matchAll(STRIPE_SECRET_KEY_PATTERN)) {
        findings.push({
          ruleId: 'stripe-secret-leak',
          severity: 'error',
          confidence: 'high',
          file: file.file,
          line: index + 1,
          message: `CRITICAL KEY LEAK: Hardcoded Stripe secret key found in source file (${match[0].slice(0, 7)}...).`,
          suggestion: 'Rotate the key and replace it with process.env.STRIPE_SECRET_KEY.',
        });
      }
    });
  }
  return result(findings);
}

/**
 * Browser-safe equivalent of `assurly scan`: same scanner-core rules, in-memory
 * files, no fs / git / ts-morph.
 */
export function scanWorkspaceFiles(files: readonly SourceInput[]): ScanResult {
  const sources = excludeGitIgnoredFiles(files.filter((file) => isScannableFile(file.file)));
  const findings: ScannerFinding[] = [];

  const sqlSources = sources.filter((file) => posixPath(file.file).endsWith('.sql'));
  if (sqlSources.length > 0) {
    findings.push(...scanSqlMigrations(sqlSources).findings);
  }

  const codeFiles = sources.filter((file) => /\.(?:[jt]sx?)$/.test(posixPath(file.file)));
  const usesStripe = projectUsesStripe(sources);

  for (const file of codeFiles) {
    findings.push(...scanRscDataLeaks(file.content, file.file).findings);
    findings.push(...scanSupabaseClientLeaks(file.content, file.file).findings);
    findings.push(...scanEdgeRuntime(file.content, file.file).findings);
    findings.push(...scanDbConnectionPooling(file.content, file.file).findings);
    if (isServerlessApiRouteFile(file.file)) {
      findings.push(...scanColdStart(file.content, file.file).findings);
    }
    if (usesStripe) {
      findings.push(...scanStripeWebhook(file.content, file.file).findings);
    }
  }

  if (usesStripe) {
    findings.push(...scanHardcodedStripeSecrets(sources).findings);
  }

  findings.push(...runDeeperStackScans(sources, { includeEdgeRuntime: false }).findings);

  const allExamples = sources.filter((file) =>
    /(?:^|\/)\.env\.example$/.test(posixPath(file.file)),
  );
  const testOnlyKeys = collectTestOnlyEnvKeys(codeFiles);

  for (const file of allExamples) {
    findings.push(
      ...scanEnvVariables(file.content, '', file.file, 'code.ts', { emitMissingCanary: false })
        .findings,
    );
  }
  if (allExamples.length === 0) {
    findings.push({
      ruleId: 'env-vars-validator',
      severity: 'warning',
      message:
        'No .env.example file found at the root of the project. It is highly recommended to document your environment variables.',
    });
  } else {
    findings.push(
      ...scanEnvVariables(allExamples[0]!.content, '', allExamples[0]!.file, 'code.ts', {
        allExamples,
      }).findings.filter((finding) => finding.ruleId === 'assurly-canary-missing'),
    );
    for (const file of codeFiles) {
      if (!isAppEnvSourceFile(file.file)) continue;
      findings.push(
        ...scanEnvVariables('', file.content, '.env.example', file.file, {
          allExamples,
          testOnlyKeys,
          emitMissingCanary: false,
        }).findings.filter((finding) => finding.file === file.file),
      );
    }
  }

  const packageJson = findExact(sources, 'package.json');
  const packageLock = findExact(sources, 'package-lock.json');
  const npmrc = findExact(sources, '.npmrc');
  const workspacePackageJsons = sources
    .map((file) => ({ file: posixPath(file.file), content: file.content }))
    .filter((file) => file.file !== 'package.json' && /(^|\/)package\.json$/.test(file.file));
  findings.push(
    ...scanSupplyChain({
      packageJson: packageJson?.content ?? null,
      packageLock: packageLock?.content ?? null,
      npmrc: npmrc?.content ?? null,
      workspacePackageJsons,
    }).findings,
  );

  for (const file of sources) {
    if (!isAgentStackFile(posixPath(file.file))) continue;
    findings.push(...scanAgentStack(file.content, posixPath(file.file)).findings);
  }

  findings.push(...scanTsconfigStrict(sources).findings);
  findings.push(...scanGithubActionsIntegration(sources).findings);

  return result(findings);
}
