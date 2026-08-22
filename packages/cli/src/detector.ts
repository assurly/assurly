import * as fs from 'fs';
import * as path from 'path';
import {
  buildScanScope,
  detectStackFromManifests,
  isScannableFile,
  type ScanScope,
} from '@assurly/scanner-core';
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
  const packageJsonRelPaths = allFiles.filter((file) => path.basename(file) === 'package.json');
  const manifests: Array<{ path: string; content: string }> = [];

  for (const relPath of packageJsonRelPaths) {
    try {
      manifests.push({
        path: relPath.replace(/\\/g, '/'),
        content: fs.readFileSync(path.join(projectPath, relPath), 'utf8'),
      });
    } catch {
      continue;
    }
  }

  return detectStackFromManifests({
    manifests,
    filePaths: allFiles.map((file) => file.replace(/\\/g, '/')),
  });
}

/**
 * Builds the project context by scanning the target directory.
 */
export function buildContext(projectPath: string): ProjectContext {
  const allFiles = listFiles(projectPath);
  const detectedStack = detectStack(projectPath, allFiles);
  const files = allFiles.filter(isScannableFile);
  const scanScope: ScanScope = buildScanScope(allFiles, files, { treePaths: allFiles });

  return {
    projectPath,
    detectedStack,
    files,
    scanScope,
  };
}
