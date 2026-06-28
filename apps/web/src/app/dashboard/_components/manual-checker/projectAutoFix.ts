import type { WebFinding } from '../../../../utils/browserScanner';
import type { ProjectFile } from './useManualScan';

export interface ProjectAutoFixBatchResult {
  files: ProjectFile[];
  /** Number of individual fixable findings addressed. */
  appliedFindingCount: number;
  modifiedFileCount: number;
  envVarsAdded: number;
  rlsTablesFixed: number;
  stripeFilesFixed: number;
  rscImportsFixed: number;
}

export function isManualFindingFixable(finding: WebFinding): boolean {
  if (finding.severity !== 'error') return false;
  const filePath = (finding.file || '').toLowerCase();
  const msg = (finding.message || '').toLowerCase();
  const isSqlRls = filePath.endsWith('.sql') && msg.includes('row-level security');
  const isEnvEx = msg.includes('environment variable') && msg.includes('not documented in');
  const isStripe =
    msg.includes('stripe webhook endpoint') && msg.includes('signature verification');
  const isRsc = msg.includes("client component ('use client') imports server-side module");
  return isSqlRls || isEnvEx || isStripe || isRsc;
}

export function getManualFindingKey(finding: WebFinding): string {
  return `${finding.file || ''}-${finding.line || 0}-${finding.message || ''}`;
}

export function countFixableFindings(findings: WebFinding[]): number {
  return findings.filter(isManualFindingFixable).length;
}

export function fixStripeWebhook(content: string): string {
  const jsonPattern = /(const|let|var)\s+(\w+)\s*=\s*await\s+req\.json\(\)/i;
  const match = content.match(jsonPattern);
  if (match) {
    const bodyVar = match[2];
    const replacement = `const rawBody = await req.text();
    const signature = req.headers.get('stripe-signature') || '';
    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid signature';
      return new Response(\`Webhook Error: \${message}\`, { status: 400 });
    }
    const ${bodyVar} = event;`;
    return content.replace(jsonPattern, replacement);
  }
  return content;
}

export function fixRscDataLeak(content: string, moduleSpecifier: string): string {
  const escaped = moduleSpecifier.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const importRegex = new RegExp(
    `(import\\s+.*\\s+from\\s+['"]${escaped}['"]|import\\s+['"]${escaped}['"])`,
    'g',
  );
  if (importRegex.test(content)) {
    return content.replace(
      importRegex,
      `// TODO: Move server-side import to a Server Component or API route\n// $1`,
    );
  }
  return content;
}

export function appendRlsFix(content: string, tableName: string): string {
  const marker = `ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY`;
  if (content.includes(marker)) {
    return content;
  }

  const fixStr = `\n\n-- Auto-Fix: Enable RLS\nALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;\n`;
  return content.endsWith('\n') || content === ''
    ? `${content}${fixStr.trim()}`
    : `${content}\n${fixStr.trim()}`;
}

function findEnvExamplePath(files: ProjectFile[]): string | null {
  const match = files.find((file) => file.path.toLowerCase().endsWith('.env.example'));
  return match?.path ?? null;
}

export function applyEnvVarsToExampleFiles(
  files: ProjectFile[],
  varNames: readonly string[],
): ProjectFile[] {
  if (varNames.length === 0) return files;

  const uniqueVars = [...new Set(varNames.map((name) => name.trim()).filter(Boolean))];
  if (uniqueVars.length === 0) return files;

  const envExamplePath = findEnvExamplePath(files);
  const additions = uniqueVars
    .filter((varName) => {
      if (!envExamplePath) return true;
      const example = files.find((file) => file.path === envExamplePath);
      if (!example) return true;
      const pattern = new RegExp(`^\\s*${varName}\\s*=`, 'm');
      return !pattern.test(example.content);
    })
    .map((varName) => `${varName}=`)
    .join('\n');

  if (!additions) return files;

  if (envExamplePath) {
    return files.map((file) => {
      if (file.path !== envExamplePath) return file;
      return {
        ...file,
        content:
          file.content.endsWith('\n') || file.content === ''
            ? `${file.content}${additions}`
            : `${file.content}\n${additions}`,
      };
    });
  }

  return [...files, { path: '.env.example', content: additions }];
}

export function applyAllFixableFindingsToProject(
  files: ProjectFile[],
  findings: WebFinding[],
): ProjectAutoFixBatchResult {
  let nextFiles = files.map((file) => ({ ...file }));
  const modifiedPaths = new Set<string>();

  const envVarNames = new Set<string>();
  const rlsByFile = new Map<string, Set<string>>();
  const stripePaths = new Set<string>();
  const rscFixes: Array<{ path: string; module: string }> = [];

  const fixableFindings = findings.filter(isManualFindingFixable);

  for (const finding of fixableFindings) {
    const filePath = finding.file || '';
    const lowerPath = filePath.toLowerCase();
    const msg = (finding.message || '').toLowerCase();

    if (msg.includes('environment variable') && msg.includes('not documented in')) {
      const varMatch = finding.message.match(/variable 'process\.env\.([^']+)'/i);
      if (varMatch?.[1]) envVarNames.add(varMatch[1]);
      continue;
    }

    if (lowerPath.endsWith('.sql') && msg.includes('row-level security')) {
      const tableMatch = finding.message.match(/table '([^']+)'/i);
      if (tableMatch?.[1]) {
        const tables = rlsByFile.get(filePath) ?? new Set<string>();
        tables.add(tableMatch[1]);
        rlsByFile.set(filePath, tables);
      }
      continue;
    }

    if (msg.includes('stripe webhook endpoint') && msg.includes('signature verification')) {
      if (filePath) stripePaths.add(filePath);
      continue;
    }

    if (msg.includes("client component ('use client') imports server-side module")) {
      const moduleMatch = finding.message.match(/database client '([^']+)'/i);
      if (filePath && moduleMatch?.[1]) {
        rscFixes.push({ path: filePath, module: moduleMatch[1] });
      }
    }
  }

  if (envVarNames.size > 0) {
    const beforePath = findEnvExamplePath(nextFiles);
    nextFiles = applyEnvVarsToExampleFiles(nextFiles, [...envVarNames]);
    modifiedPaths.add(beforePath ?? '.env.example');
  }

  for (const [path, tables] of rlsByFile) {
    nextFiles = nextFiles.map((file) => {
      if (file.path !== path) return file;
      let content = file.content;
      for (const tableName of tables) {
        content = appendRlsFix(content, tableName);
      }
      modifiedPaths.add(path);
      return { ...file, content };
    });
  }

  for (const path of stripePaths) {
    nextFiles = nextFiles.map((file) => {
      if (file.path !== path) return file;
      modifiedPaths.add(path);
      return { ...file, content: fixStripeWebhook(file.content) };
    });
  }

  const rscSeen = new Set<string>();
  for (const { path, module } of rscFixes) {
    const dedupeKey = `${path}::${module}`;
    if (rscSeen.has(dedupeKey)) continue;
    rscSeen.add(dedupeKey);
    nextFiles = nextFiles.map((file) => {
      if (file.path !== path) return file;
      modifiedPaths.add(path);
      return { ...file, content: fixRscDataLeak(file.content, module) };
    });
  }

  return {
    files: nextFiles,
    appliedFindingCount: fixableFindings.length,
    modifiedFileCount: modifiedPaths.size,
    envVarsAdded: envVarNames.size,
    rlsTablesFixed: [...rlsByFile.values()].reduce((total, tables) => total + tables.size, 0),
    stripeFilesFixed: stripePaths.size,
    rscImportsFixed: rscSeen.size,
  };
}

export function applySingleFindingToProject(
  files: ProjectFile[],
  finding: WebFinding,
): ProjectFile[] {
  return applyAllFixableFindingsToProject(files, [finding]).files;
}

export function buildBatchFixToastMessage(
  result: ProjectAutoFixBatchResult,
  remainingErrorCount: number,
): string {
  if (result.appliedFindingCount === 0) {
    return 'No auto-fixable issues were found in this project.';
  }

  const parts = [
    `Applied ${result.appliedFindingCount} auto-fix${result.appliedFindingCount === 1 ? '' : 'es'} across ${result.modifiedFileCount} file${result.modifiedFileCount === 1 ? '' : 's'}.`,
  ];

  if (remainingErrorCount > 0) {
    parts.push(
      `${remainingErrorCount} blocking error${remainingErrorCount === 1 ? '' : 's'} still require manual review.`,
    );
  } else {
    parts.push('All blocking errors that ShipReady can auto-fix locally are resolved.');
  }

  return parts.join(' ');
}
