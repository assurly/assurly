import * as fs from 'fs';
import * as path from 'path';
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
 */
export function detectStack(projectPath: string): TechStack {
  const stack: TechStack = {
    framework: 'unknown',
    database: 'none',
    payments: 'none',
    deployment: 'unknown',
  };

  const packageJsonPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return stack;
  }

  try {
    const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonContent);
    const allDeps = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {}),
    };

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
    if (fs.existsSync(path.join(projectPath, 'vercel.json')) || allDeps['@vercel/analytics']) {
      stack.deployment = 'vercel';
    } else if (stack.framework === 'nextjs') {
      // Default deployment platform for Next.js is Vercel
      stack.deployment = 'vercel';
    }
  } catch (error) {
    // If json parsing fails, fallback to defaults
  }

  return stack;
}

/**
 * Builds the project context by scanning the target directory.
 */
export function buildContext(projectPath: string): ProjectContext {
  const detectedStack = detectStack(projectPath);
  const files = listFiles(projectPath);

  return {
    projectPath,
    detectedStack,
    files,
  };
}
