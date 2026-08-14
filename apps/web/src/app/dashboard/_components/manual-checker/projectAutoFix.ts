import {
  proposeEnvExamplePath,
  resolveEnvExampleForPath,
  type WebFinding,
} from '../../../../utils/browserScanner';
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
  const filePath = (finding.file || '').toLowerCase();
  const msg = (finding.message || '').toLowerCase();
  const isEnvEx =
    finding.ruleId === 'undocumented-env' ||
    (msg.includes('environment variable') && msg.includes('not documented in'));
  // undocumented-env is warning-only hygiene, but still auto-fixable locally.
  if (isEnvEx) return true;

  if (finding.severity !== 'error') return false;

  const isSqlRls = filePath.endsWith('.sql') && msg.includes('row-level security');
  const isStripe =
    msg.includes('stripe webhook endpoint') && msg.includes('signature verification');
  const isRsc = msg.includes("client component ('use client') imports server-side module");
  return isSqlRls || isStripe || isRsc;
}

export function getManualFindingKey(finding: WebFinding): string {
  return `${finding.file || ''}-${finding.line || 0}-${finding.message || ''}`;
}

export function countFixableFindings(findings: WebFinding[]): number {
  return findings.filter(isManualFindingFixable).length;
}

/**
 * Replaces an unauthenticated `await req.json()` webhook body read with
 * Stripe signature verification. Preserves the original statement indent and
 * strips the demo "Vulnerability: …" comment when present.
 */
export function fixStripeWebhook(content: string): string {
  const jsonPattern = /^([ \t]*)(const|let|var)\s+(\w+)\s*=\s*await\s+req\.json\(\)\s*;?/m;
  const match = content.match(jsonPattern);
  if (!match || match.index === undefined) {
    return content;
  }

  const indent = match[1];
  const bodyVar = match[3];
  const nested = `${indent}  `;
  const replacement = [
    `${indent}const rawBody = await req.text();`,
    `${indent}const signature = req.headers.get('stripe-signature') || '';`,
    `${indent}let event;`,
    `${indent}try {`,
    `${nested}event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!);`,
    `${indent}} catch (error: unknown) {`,
    `${nested}const message = error instanceof Error ? error.message : 'Invalid signature';`,
    `${nested}return new Response(\`Webhook Error: \${message}\`, { status: 400 });`,
    `${indent}}`,
    `${indent}const ${bodyVar} = event;`,
  ].join('\n');

  // Drop the demo vulnerability comment on the line immediately above the match.
  let start = match.index;
  const before = content.slice(0, match.index);
  const prevComment = before.match(
    /(?:^|\n)([ \t]*\/\/[ \t]*Vulnerability:.*[Ss]tripe.*signature[^\n]*\n)$/,
  );
  if (prevComment?.[1]) {
    start = before.length - prevComment[1].length;
  }

  return `${content.slice(0, start)}${replacement}${content.slice(match.index + match[0].length)}`;
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

/** Parse undocumented-env finding → variable name + correct .env.example target path. */
export function parseUndocumentedEnvTarget(finding: {
  message?: string;
  suggestion?: string;
  file?: string;
}): { varName: string; examplePath: string } | null {
  const message = finding.message ?? '';
  const varMatch = message.match(/variable 'process\.env\.([^']+)'/i);
  if (!varMatch?.[1]) return null;

  const pathFromMessage = message.match(/not documented in '([^']+)'/i)?.[1];
  const pathFromSuggestion = finding.suggestion
    ?.match(/^Add\s+\S+=\s+to\s+(.+?)\.?$/i)?.[1]
    ?.trim();
  const examplePath =
    pathFromMessage ||
    pathFromSuggestion ||
    (finding.file ? proposeEnvExamplePath(finding.file) : '.env.example');

  return { varName: varMatch[1], examplePath };
}

export function applyEnvVarsToExampleFiles(
  files: ProjectFile[],
  varNames: readonly string[],
  targetExamplePath?: string,
): ProjectFile[] {
  if (varNames.length === 0) return files;

  const uniqueVars = [...new Set(varNames.map((name) => name.trim()).filter(Boolean))];
  if (uniqueVars.length === 0) return files;

  const envExamplePath = targetExamplePath ?? findEnvExamplePath(files) ?? '.env.example';
  const existing = files.find((file) => file.path === envExamplePath);
  const additions = uniqueVars
    .filter((varName) => {
      if (!existing) return true;
      const pattern = new RegExp(`^\\s*${varName}\\s*=`, 'm');
      return !pattern.test(existing.content);
    })
    .map((varName) => `${varName}=`)
    .join('\n');

  if (!additions) return files;

  if (existing) {
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

  return [...files, { path: envExamplePath, content: additions }];
}

export function applyAllFixableFindingsToProject(
  files: ProjectFile[],
  findings: WebFinding[],
): ProjectAutoFixBatchResult {
  let nextFiles = files.map((file) => ({ ...file }));
  const modifiedPaths = new Set<string>();

  const envVarsByTarget = new Map<string, Set<string>>();
  const rlsByFile = new Map<string, Set<string>>();
  const stripePaths = new Set<string>();
  const rscFixes: Array<{ path: string; module: string }> = [];

  const fixableFindings = findings.filter(isManualFindingFixable);

  const addEnvVar = (examplePath: string, varName: string): void => {
    const bucket = envVarsByTarget.get(examplePath) ?? new Set<string>();
    bucket.add(varName);
    envVarsByTarget.set(examplePath, bucket);
  };

  for (const finding of fixableFindings) {
    const filePath = finding.file || '';
    const lowerPath = filePath.toLowerCase();
    const msg = (finding.message || '').toLowerCase();

    if (msg.includes('environment variable') && msg.includes('not documented in')) {
      const parsed = parseUndocumentedEnvTarget(finding);
      if (parsed) addEnvVar(parsed.examplePath, parsed.varName);
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

  // Stripe webhook autofix introduces STRIPE_WEBHOOK_SECRET — document it on the
  // package-local example (or nearest ancestor), never a sibling package's file.
  if (stripePaths.size > 0) {
    const examples = nextFiles
      .filter((file) => /(?:^|\/)\.env\.example$/i.test(file.path))
      .map((file) => ({ file: file.path, content: file.content }));
    for (const stripePath of stripePaths) {
      const resolved = resolveEnvExampleForPath(stripePath, examples);
      addEnvVar(resolved?.file ?? proposeEnvExamplePath(stripePath), 'STRIPE_WEBHOOK_SECRET');
    }
  }

  let envVarsAdded = 0;
  for (const [examplePath, varNames] of envVarsByTarget) {
    const before = nextFiles.find((file) => file.path === examplePath)?.content;
    nextFiles = applyEnvVarsToExampleFiles(nextFiles, [...varNames], examplePath);
    const after = nextFiles.find((file) => file.path === examplePath)?.content;
    if (after && after !== before) {
      modifiedPaths.add(examplePath);
      for (const varName of varNames) {
        if (!before || !new RegExp(`^\\s*${varName}\\s*=`, 'm').test(before)) {
          envVarsAdded += 1;
        }
      }
    }
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
    envVarsAdded,
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
      `${remainingErrorCount} blocker${remainingErrorCount === 1 ? '' : 's'} still require manual review.`,
    );
  } else {
    parts.push('All blockers that Assurly can auto-fix locally are resolved.');
  }

  return parts.join(' ');
}
