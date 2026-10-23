/**
 * The dashboard's Instant Gate engine, without React or the network: which
 * files a scan reads, every rule it runs over them, and the Ship Gate verdict.
 * DashboardClient feeds it files fetched from GitHub; the corpus parity test
 * feeds it files from disk, so what the gate pins is what users see.
 */
import {
  collectDependencyNames,
  collectNextConfigEnvKeys,
  countCleanScannedFiles,
  isNextConfigPath,
  isProjectTsconfigPath,
  parsePackageJsonDependencies,
  scanDbConnectionPooling,
  scanStripeLiveKeyInDev,
  scanSupplyChain,
  scanTsconfigStrict,
  type ScanScopeTotals,
  type ShipGateReport,
  type SourceInput,
} from '@assurly/scanner-core';
import {
  buildScanScope,
  detectStackFromManifests,
  githubActionsIntegrationMessage,
  incompleteScanFinding,
  INSTANT_GATE_MAX_FILES,
  instantGateSurfaceFiles,
  isAgentStackFile,
  isAnalyzedCodeFile,
  isScannableFile,
  languageCoveragePaths,
  rankFilesByRelevance,
  scanAgentStack,
  scanColdStart,
  scanEdgeRuntime,
  scanEnvVariables,
  scanMaxDuration,
  scanRouteHandlerAuth,
  scanRscDataLeaks,
  scanServerActionAuth,
  scanServiceRoleBypass,
  scanSqlMigrations,
  scanStripeMissingSubscriptionEvents,
  scanStripeWebhook,
  scanStripeWebhookIdempotencyForProject,
  scanSupabaseClientLeaks,
  selectFiles,
  selectPackageManifestPaths,
  summarizeUnanalyzedSource,
  unanalyzedLanguageCounts,
  unanalyzedSourceFinding,
  type ScanScope,
  type WebFinding,
} from './browserScanner';
import { buildShipGateFromWebFindings } from './shipGate';

/** Dev and test env files, where a live Stripe key does not belong. Same set as the CLI. */
const DEV_ENV_FILE = /(?:^|\/)\.env(?:\.(?:local|development|dev|test|staging))?$/;

export interface TreeEntry {
  path: string;
  type: string;
}

/** What one Instant Gate scan reads, decided from the repository tree alone. */
export function planDashboardScan(tree: readonly TreeEntry[]) {
  const sqlFiles: string[] = [];
  const envFiles: string[] = [];
  const codeFiles: string[] = [];
  const agentFiles: string[] = [];

  for (const node of tree) {
    if (node.type !== 'blob') continue;
    if (!isScannableFile(node.path)) continue;
    const pathLower = node.path.toLowerCase();

    if (isAgentStackFile(node.path)) {
      agentFiles.push(node.path);
    } else if (pathLower.endsWith('.sql')) {
      sqlFiles.push(node.path);
    } else if (
      pathLower.endsWith('.env.example') ||
      pathLower === '.env' ||
      pathLower.endsWith('.env.local')
    ) {
      envFiles.push(node.path);
    } else if (isAnalyzedCodeFile(node.path)) {
      codeFiles.push(node.path);
    }
  }

  const treePaths = tree.filter((node) => node.type === 'blob').map((node) => node.path);
  const packageJsonPaths = selectPackageManifestPaths(treePaths);
  const rankedCandidates = rankFilesByRelevance(
    instantGateSurfaceFiles([...new Set([...sqlFiles, ...codeFiles])], (path) => path),
    (path) => path,
  );
  const fileSelection = selectFiles(rankedCandidates, INSTANT_GATE_MAX_FILES);
  const unanalyzedSummary = summarizeUnanalyzedSource(
    languageCoveragePaths(treePaths.filter((path) => isScannableFile(path))),
  );

  const selectedFiles = new Set(fileSelection.files);
  const sqlToScan = sqlFiles.filter((path) => selectedFiles.has(path));
  const codeToScan = codeFiles.filter((path) => selectedFiles.has(path));
  const stripeToScan = codeToScan.filter(
    (p) => p.toLowerCase().includes('stripe') || p.toLowerCase().includes('webhook'),
  );
  const envExamplePaths = envFiles.filter((path) => path.endsWith('.env.example'));
  const workflowPaths = treePaths.filter((path) =>
    /^\.github\/workflows\/.*\.(ya?ml)$/i.test(path.replace(/\\/g, '/')),
  );
  // Read whole, outside the file limit, exactly as the CLI reads them.
  const devEnvPaths = treePaths.filter((path) => DEV_ENV_FILE.test(path));
  const tsconfigPaths = treePaths.filter(isProjectTsconfigPath);
  const supplyChainPaths = treePaths.filter(
    (path) => path === 'package-lock.json' || path === '.npmrc',
  );
  const filesToFetch = [
    ...new Set([
      ...sqlToScan,
      ...codeToScan,
      ...envExamplePaths,
      ...workflowPaths,
      ...agentFiles,
      ...packageJsonPaths,
      ...devEnvPaths,
      ...tsconfigPaths,
      ...supplyChainPaths,
    ]),
  ];

  return {
    treePaths,
    codeFiles,
    agentFiles,
    packageJsonPaths,
    rankedCandidates,
    fileSelection,
    unanalyzedSummary,
    sqlToScan,
    codeToScan,
    stripeToScan,
    envExamplePaths,
    workflowPaths,
    devEnvPaths,
    tsconfigPaths,
    filesToFetch,
  };
}

export type DashboardScanPlan = ReturnType<typeof planDashboardScan>;

export function dashboardScanScope(
  plan: DashboardScanPlan,
  scopeTotals?: ScanScopeTotals,
): ScanScope {
  return buildScanScope(plan.rankedCandidates, plan.fileSelection.files, {
    treePaths: plan.treePaths,
    unanalyzed: unanalyzedLanguageCounts(plan.unanalyzedSummary),
    ...(scopeTotals ? { totals: scopeTotals } : {}),
    limit: INSTANT_GATE_MAX_FILES,
  });
}

/** What the scan could not read: past the file limit, or a language Assurly does not analyse. */
export function dashboardCoverageFindings(
  plan: DashboardScanPlan,
  scopeTotals?: ScanScopeTotals,
): WebFinding[] {
  const findings: WebFinding[] = [];
  const incomplete = incompleteScanFinding(plan.fileSelection, {
    ...(scopeTotals
      ? {
          eligibleTotal: scopeTotals.surfaceAnalyzable,
          eligibleTotalIsLowerBound: scopeTotals.partial === true,
        }
      : {}),
  });
  if (incomplete) findings.push(incomplete);
  const unanalyzed = unanalyzedSourceFinding(plan.unanalyzedSummary);
  if (unanalyzed) findings.push(unanalyzed);
  return findings;
}

export interface DashboardManifests {
  manifests: Array<{ path: string; content: string }>;
  detectedStack: ReturnType<typeof detectStackFromManifests>;
}

/** The package.json files the plan found, and the stack they declare. */
export async function loadDashboardManifests(
  plan: DashboardScanPlan,
  load: (path: string) => Promise<string | null>,
): Promise<DashboardManifests> {
  const manifests: Array<{ path: string; content: string }> = [];
  for (const manifestPath of plan.packageJsonPaths) {
    const content = await load(manifestPath);
    if (content !== null) manifests.push({ path: manifestPath, content });
  }
  return {
    manifests,
    detectedStack: detectStackFromManifests({ manifests, filePaths: plan.treePaths }),
  };
}

export interface DependencyProvenanceResult {
  findings: WebFinding[];
}

export interface DashboardRuleHooks {
  /** Stops between files; whatever was found so far is returned. */
  signal?: AbortSignal;
  onLog?: (line: string) => void;
  onProgress?: (percent: number) => void;
  /** The npm registry check, which runs on the server. Omitted, it is skipped. */
  dependencyProvenance?: (declared: string[]) => Promise<DependencyProvenanceResult>;
}

/**
 * Every Instant Gate rule over the files the plan selected. `load` returns a
 * file's content, or null when it cannot be read; the caller decides where
 * content comes from (GitHub, a cache, the disk).
 */
export async function runDashboardRules(
  plan: DashboardScanPlan,
  load: (path: string) => Promise<string | null>,
  { manifests, detectedStack }: DashboardManifests,
  hooks: DashboardRuleHooks = {},
): Promise<WebFinding[]> {
  const { signal, onLog = () => undefined, onProgress = () => undefined } = hooks;
  const aborted = (): boolean => signal?.aborted === true;
  const findings: WebFinding[] = [];

  // SQL migrations in one batch so RLS correlation and the Supabase stack
  // signal apply across files, not per migration.
  const sqlSources: SourceInput[] = [];
  for (const sqlPath of plan.sqlToScan) {
    if (aborted()) break;
    const content = await load(sqlPath);
    if (content === null) continue;
    sqlSources.push({ file: sqlPath, content });
  }
  if (sqlSources.length > 0) {
    const scan = scanSqlMigrations(sqlSources, {
      usesSupabase: detectedStack.database === 'supabase',
    });
    findings.push(...scan.findings);
    for (const source of sqlSources) {
      const fileFindings = scan.findings.filter((finding) => finding.file === source.file);
      const errorCount = fileFindings.filter((finding) => finding.severity === 'error').length;
      const warningCount = fileFindings.filter((finding) => finding.severity === 'warning').length;
      onLog(`  ✓ Scanned ${source.file}: ${errorCount} errors, ${warningCount} warnings.`);
    }
  }

  onProgress(50);

  for (const webhookPath of plan.stripeToScan) {
    if (aborted()) break;
    const content = await load(webhookPath);
    if (content === null) continue;
    const scan = scanStripeWebhook(content, webhookPath);
    findings.push(...scan.findings);
    onLog(`  ✓ Scanned ${webhookPath}: ${scan.errorCount} errors.`);
  }

  onProgress(65);

  // Environment variables, matched per app root's .env.example.
  if (plan.envExamplePaths.length > 0) {
    onLog('⚙ Reading env configuration files...');
    const allExamples: Array<{ file: string; content: string }> = [];
    for (const examplePath of plan.envExamplePaths) {
      const envContent = await load(examplePath);
      if (envContent !== null) allExamples.push({ file: examplePath, content: envContent });
    }

    if (allExamples.length > 0) {
      const rootExample =
        allExamples.find((example) => example.file === '.env.example') ?? allExamples[0];
      const nextConfigs: Array<{ file: string; content: string }> = [];
      for (const configPath of plan.codeFiles.filter(isNextConfigPath)) {
        const content = await load(configPath);
        if (content !== null) nextConfigs.push({ file: configPath, content });
      }
      const configDefinedKeys = collectNextConfigEnvKeys(nextConfigs);

      for (const codePath of plan.codeToScan) {
        const codeContent = await load(codePath);
        if (codeContent === null) continue;
        const scan = scanEnvVariables(
          rootExample.content,
          codeContent,
          rootExample.file,
          codePath,
          {
            allExamples,
            configDefinedKeys,
          },
        );
        findings.push(...scan.findings.filter((finding) => finding.ruleId === 'undocumented-env'));
      }

      const secretScan = scanEnvVariables(
        rootExample.content,
        '',
        rootExample.file,
        'Repository Codebase',
        { allExamples },
      );
      findings.push(
        ...secretScan.findings.filter((finding) => finding.ruleId !== 'undocumented-env'),
      );

      onLog(`  ✓ Checked env variables across ${plan.envExamplePaths.length} example file(s).`);
    }
  }

  onProgress(80);

  const codeSources: SourceInput[] = [];
  for (const codePath of plan.codeToScan) {
    if (aborted()) break;
    const content = await load(codePath);
    if (content === null) continue;
    codeSources.push({ file: codePath, content });

    findings.push(...scanEdgeRuntime(content, codePath).findings);
    findings.push(...scanMaxDuration(content, codePath).findings);
    findings.push(...scanServerActionAuth(content, codePath).findings);
    findings.push(...scanRouteHandlerAuth(content, codePath).findings);
    findings.push(...scanServiceRoleBypass(content, codePath).findings);
    findings.push(...scanStripeMissingSubscriptionEvents(content, codePath).findings);
    findings.push(...scanRscDataLeaks(content, codePath).findings);
    findings.push(...scanSupabaseClientLeaks(content, codePath).findings);
    if (codePath.includes('/api/')) findings.push(...scanColdStart(content, codePath).findings);
    findings.push(...scanDbConnectionPooling(content, codePath).findings);
  }

  if (!aborted()) {
    findings.push(...scanStripeWebhookIdempotencyForProject(codeSources).findings);
  }

  for (const envPath of plan.devEnvPaths) {
    const content = await load(envPath);
    if (content !== null) findings.push(...scanStripeLiveKeyInDev(content, envPath).findings);
  }

  const tsconfigSources: SourceInput[] = [];
  for (const tsconfigPath of plan.tsconfigPaths) {
    const content = await load(tsconfigPath);
    if (content !== null) tsconfigSources.push({ file: tsconfigPath, content });
  }
  findings.push(
    ...scanTsconfigStrict(tsconfigSources, {
      usesTypeScript: plan.treePaths.some((path) => /\.(?:ts|tsx|mts|cts)$/.test(path)),
    }).findings,
  );

  // Install-time trust, from the root manifest, lockfile and .npmrc. A lockfile
  // past the proxy's size limit reads as null and the check is skipped.
  const rootManifest = manifests.find((manifest) => manifest.path === 'package.json');
  findings.push(
    ...scanSupplyChain({
      packageJson: rootManifest?.content ?? null,
      packageLock: plan.filesToFetch.includes('package-lock.json')
        ? await load('package-lock.json')
        : null,
      npmrc: plan.filesToFetch.includes('.npmrc') ? await load('.npmrc') : null,
      workspacePackageJsons: manifests
        .filter((manifest) => manifest.path !== 'package.json')
        .map((manifest) => ({ file: manifest.path, content: manifest.content })),
    }).findings,
  );

  // Agent stack: MCP configs and instruction files (advisory; never blocks).
  if (plan.agentFiles.length > 0) {
    onLog(`🤖 Scanning ${plan.agentFiles.length} agent-stack file(s)...`);
    for (const agentPath of plan.agentFiles) {
      if (aborted()) break;
      const content = await load(agentPath);
      if (content === null) continue;
      findings.push(...scanAgentStack(content, agentPath).findings);
    }
  }

  // Dependency provenance runs on the server; a registry outage must not fail
  // the rest of the scan.
  if (hooks.dependencyProvenance && manifests.length > 0 && !aborted()) {
    try {
      const declared = [
        ...new Set(
          manifests.flatMap((manifest) => {
            const parsedManifest = parsePackageJsonDependencies(manifest.content);
            return parsedManifest ? [...collectDependencyNames(parsedManifest)] : [];
          }),
        ),
      ];
      if (declared.length > 0) {
        onLog(`📦 Checking dependency provenance (${declared.length} package(s))...`);
        const result = await hooks.dependencyProvenance(declared);
        if (!aborted()) findings.push(...result.findings);
      }
    } catch {
      // Intentionally empty — provenance is best-effort on the dashboard path.
    }
  }

  let hasScanWorkflow = false;
  for (const workflowPath of plan.workflowPaths) {
    const workflowContent = await load(workflowPath);
    if (
      workflowContent !== null &&
      /assurly|npm\s+run\s+scan(?::self)?|npx\s+assurly\s+scan/i.test(workflowContent)
    ) {
      hasScanWorkflow = true;
      break;
    }
  }
  if (!hasScanWorkflow) {
    findings.push({
      ruleId: 'github-actions-integration',
      severity: 'warning',
      file: 'Global Configs',
      message: githubActionsIntegrationMessage(plan.workflowPaths.length),
      suggestion:
        'Run "npx assurly init" in your repository to automatically configure the CI/CD pipeline.',
    });
  }

  return findings;
}

/** The verdict the dashboard shows and saves for one Instant Gate scan. */
export function dashboardShipGate(
  findings: WebFinding[],
  plan: DashboardScanPlan,
  scanScope: ScanScope,
): ShipGateReport {
  return buildShipGateFromWebFindings(findings, {
    scannedFileCount: plan.fileSelection.files.length,
    cleanFileCount: countCleanScannedFiles(
      plan.fileSelection.files.length,
      findings.map((finding) => finding.file),
      plan.fileSelection.files,
    ),
    scanScope,
  });
}
