export type DetectedFramework = 'nextjs' | 'unknown';
export type DetectedDatabase = 'supabase' | 'prisma' | 'none';
export type DetectedPayments = 'stripe' | 'none';
export type DetectedDeployment = 'vercel' | 'unknown';

export interface DetectedStack {
  framework: DetectedFramework;
  database: DetectedDatabase;
  payments: DetectedPayments;
  deployment: DetectedDeployment;
}

export interface PackageManifestInput {
  path: string;
  content: string;
}

export interface DetectStackFromManifestsInput {
  manifests: readonly PackageManifestInput[];
  filePaths?: readonly string[];
}

/** Cap nested-manifest fetches in the browser Instant Gate. */
export const MAX_PACKAGE_MANIFESTS = 8;

const EMPTY_STACK: DetectedStack = {
  framework: 'unknown',
  database: 'none',
  payments: 'none',
  deployment: 'unknown',
};

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function isNodeModulesPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return normalized.includes('/node_modules/') || normalized.startsWith('node_modules/');
}

function isPackageJsonPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return normalized === 'package.json' || normalized.endsWith('/package.json');
}

function depthOf(filePath: string): number {
  return normalizePath(filePath).split('/').length;
}

/**
 * Nested workspace manifests, shallowest first, excluding `node_modules`.
 */
export function selectPackageManifestPaths(
  filePaths: readonly string[],
  limit = MAX_PACKAGE_MANIFESTS,
): string[] {
  return filePaths
    .filter((filePath) => isPackageJsonPath(filePath) && !isNodeModulesPath(filePath))
    .sort(
      (left, right) =>
        depthOf(left) - depthOf(right) || normalizePath(left).localeCompare(normalizePath(right)),
    )
    .slice(0, limit);
}

function siblingVercelJson(manifestPath: string): string {
  const normalized = normalizePath(manifestPath);
  const slash = normalized.lastIndexOf('/');
  if (slash === -1) return 'vercel.json';
  return `${normalized.slice(0, slash)}/vercel.json`;
}

function parseDependencyNames(content: string): Record<string, string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as { dependencies?: unknown; devDependencies?: unknown };
  const names: Record<string, string> = {};
  for (const bag of [record.dependencies, record.devDependencies]) {
    if (!bag || typeof bag !== 'object' || Array.isArray(bag)) continue;
    for (const [name, version] of Object.entries(bag as Record<string, unknown>)) {
      names[name] = typeof version === 'string' ? version : '';
    }
  }
  return names;
}

/**
 * Merge every workspace `package.json` the same way the CLI detector does.
 * A root-only read reports unknown/none on monorepos whose deps live in `web/`
 * or `apps/web/`.
 */
export function detectStackFromManifests(input: DetectStackFromManifestsInput): DetectedStack {
  const stack: DetectedStack = { ...EMPTY_STACK };
  const filePaths = (input.filePaths ?? []).map(normalizePath);
  const filePathSet = new Set(filePaths);
  const allDeps: Record<string, string> = {};
  let sawVercelConfig = filePathSet.has('vercel.json');

  for (const manifest of input.manifests) {
    if (isNodeModulesPath(manifest.path)) continue;
    const deps = parseDependencyNames(manifest.content);
    if (!deps) continue;
    Object.assign(allDeps, deps);
    if (filePathSet.has(siblingVercelJson(manifest.path))) {
      sawVercelConfig = true;
    }
  }

  if (allDeps['next']) {
    stack.framework = 'nextjs';
  }

  if (allDeps['@supabase/supabase-js'] || allDeps['@supabase/ssr']) {
    stack.database = 'supabase';
  } else if (allDeps['prisma'] || allDeps['@prisma/client']) {
    stack.database = 'prisma';
  }

  if (allDeps['stripe'] || allDeps['@stripe/stripe-js']) {
    stack.payments = 'stripe';
  }

  if (sawVercelConfig || allDeps['@vercel/analytics']) {
    stack.deployment = 'vercel';
  } else if (stack.framework === 'nextjs') {
    stack.deployment = 'vercel';
  }

  return stack;
}

export function describeDetectedStack(stack: DetectedStack): {
  framework: string;
  supabase: 'Detected' | 'Not Detected';
  stripe: 'Detected' | 'Not Detected';
} {
  let framework: string;
  switch (stack.framework) {
    case 'nextjs':
      framework = 'Next.js';
      break;
    case 'unknown':
      framework = 'Unknown';
      break;
    default: {
      const exhaustive: never = stack.framework;
      framework = exhaustive;
      break;
    }
  }

  return {
    framework,
    supabase: stack.database === 'supabase' ? 'Detected' : 'Not Detected',
    stripe: stack.payments === 'stripe' ? 'Detected' : 'Not Detected',
  };
}
