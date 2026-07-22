import { TechStack, ProjectContext } from './types';
/**
 * Recursively scans a directory to list all file paths, ignoring common system/dependency folders.
 */
export declare function listFiles(dir: string, baseDir?: string): string[];
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
export declare function detectStack(projectPath: string, allFiles?: string[]): TechStack;
/**
 * Builds the project context by scanning the target directory.
 */
export declare function buildContext(projectPath: string): ProjectContext;
