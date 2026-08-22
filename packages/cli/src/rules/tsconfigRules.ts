import * as fs from 'fs';
import * as path from 'path';
import { scanTsconfigStrict, type SourceInput } from '@assurly/scanner-core';
import { Rule, Finding, ProjectContext } from '../types';

function posixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function isTsconfigScanPath(relativePath: string): boolean {
  const posix = posixPath(relativePath);
  return posix === 'tsconfig.json' || /^(apps|packages)\/[^/]+\/tsconfig\.json$/.test(posix);
}

function readTsconfigSources(projectPath: string, files: readonly string[]): SourceInput[] {
  const listed = files.filter(isTsconfigScanPath).map(posixPath);
  if (!listed.includes('tsconfig.json')) {
    const rootFull = path.join(projectPath, 'tsconfig.json');
    if (fs.existsSync(rootFull)) listed.unshift('tsconfig.json');
  }

  const sources: SourceInput[] = [];
  const seen = new Set<string>();
  for (const relative of listed) {
    if (seen.has(relative)) continue;
    seen.add(relative);
    try {
      sources.push({
        file: relative,
        content: fs.readFileSync(path.join(projectPath, relative), 'utf8'),
      });
    } catch {
      // Skip unreadable paths; scanTsconfigStrict treats an empty set as missing.
    }
  }
  return sources;
}

/**
 * Rule to check if strict mode is enabled in tsconfig.json.
 */
export const tsconfigRules: Rule = {
  id: 'typescript-strict-mode',
  name: 'TypeScript Strict Mode Validation',
  description:
    'Ensures compilerOptions.strict is set to true in tsconfig.json to enforce maximum type safety.',
  severity: 'warning',

  async run(context: ProjectContext): Promise<Finding[]> {
    return scanTsconfigStrict(readTsconfigSources(context.projectPath, context.files)).findings;
  },
};
