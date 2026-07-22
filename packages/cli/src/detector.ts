import * as fs from 'fs';
import * as path from 'path';
import { buildScanScope, isScannableFile, type ScanScope } from '@assurly/scanner-core';
import { TechStack, ProjectContext } from './types';

/**
 * Recursively scans a directory to list all file paths, ignoring common system/dependency folders.
 */
export function listFiles(dir: string, baseDir: string = dir): string[] {
  let results: string[] = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    // Ignore dependency, build, and system folders
    if (
      item === 'node_modules' ||
      item === '.git' ||
      item === '.next' ||
      item === 'dist' ||
      item === 'build' ||
      item === 'coverage' ||
      item === '.DS_Store'
    ) {
      continue;
    }

    if (stat.isDirectory()) {
      results = results.concat(listFiles(fullPath, baseDir));
    } else if (stat.isFile()) {
      // Return path relative to the project root
      results.push(path.relative(baseDir, fullPath));
    }
  }

  return results;
}

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Detects the technologies used in the project by reading package.json and file structure.
 *
 * Reads every package.json under the project, not just the root one: in npm/pnpm/yarn
 * workspace monorepos (Turborepo, Nx, etc.) the root manifest is typically a bare workspace
 * pointer with no dependencies of its own, while the actual framework/database/payments
 * packages live in nested manifests (e.g. apps/web/package.json). A root-only read reported
 * every field as unknown/none on such repos, which silently disabled every Stripe and
 * Supabase rule (both gate on detectedStack.payments/database — see stripeRules.ts,
 * supabaseRules.ts) instead of flagging real issues.
 *
 * `allFiles` should be relative paths as returned by `listFiles`; pass it through from
 * `buildContext` to avoid walking the tree twice. Falls back to its own walk when omitted so
 * the function stays usable on its own (e.g. from tests).
 */
export function detectStack(
  projectPath: string,
  allFiles: string[] = listFiles(projectPath),
): TechStack {
  const stack: TechStack = {
    framework: 'unknown',
    database: 'none',
    payments: 'none',
    deployment: 'unknown',
  };

  const packageJsonRelPaths = allFiles.filter((f) => path.basename(f) === 'package.json');
  if (packageJsonRelPaths.length === 0) {
    return stack;
  }

  const allDeps: Record<string, string> = {};
  let sawVercelConfig = false;

  for (const relPath of packageJsonRelPaths) {
    const absPath = path.join(projectPath, relPath);
    let packageJson: PackageJsonShape;
    try {
      packageJson = JSON.parse(fs.readFileSync(absPath, 'utf8'));
    } catch {
      continue; // Malformed manifest in one workspace member shouldn't blank out the rest.
    }
    Object.assign(allDeps, packageJson.dependencies ?? {}, packageJson.devDependencies ?? {});
    if (fs.existsSync(path.join(path.dirname(absPath), 'vercel.json'))) {
      sawVercelConfig = true;
    }
  }

  // Framework detection
  if (allDeps['next']) {
    stack.framework = 'nextjs';
  }

  // Database detection
  if (allDeps['@supabase/supabase-js'] || allDeps['@supabase/ssr']) {
    stack.database = 'supabase';
  } else if (allDeps['prisma'] || allDeps['@prisma/client']) {
    stack.database = 'prisma';
  }

  // Payments detection
  if (allDeps['stripe'] || allDeps['@stripe/stripe-js']) {
    stack.payments = 'stripe';
  }

  // Deployment platform heuristic
  if (sawVercelConfig || allDeps['@vercel/analytics']) {
    stack.deployment = 'vercel';
  } else if (stack.framework === 'nextjs') {
    // Default deployment platform for Next.js is Vercel
    stack.deployment = 'vercel';
  }

  return stack;
}

/**
 * Builds the project context by scanning the target directory.
 */
export function buildContext(projectPath: string): ProjectContext {
  const allFiles = listFiles(projectPath);
  const detectedStack = detectStack(projectPath, allFiles);
  const files = allFiles.filter(isScannableFile);
  const scanScope: ScanScope = buildScanScope(allFiles, files);

  return {
    projectPath,
    detectedStack,
    files,
    scanScope,
  };
}
