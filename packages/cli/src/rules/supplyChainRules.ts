import * as fs from 'fs';
import * as path from 'path';
import { scanSupplyChain, type ScannerFinding } from '@assurly/scanner-core';
import { Finding, ProjectContext, Rule } from '../types';

function toFinding(finding: ScannerFinding): Finding {
  return {
    ruleId: finding.ruleId,
    severity: finding.severity,
    confidence: finding.confidence,
    file: finding.file,
    line: finding.line,
    message: finding.message,
    suggestion: finding.suggestion,
  };
}

function readProjectFile(projectPath: string, relativePath: string): string | null {
  try {
    return fs.readFileSync(path.join(projectPath, relativePath), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Install-time trust — audits npm 12+ allowScripts / lockfile install scripts /
 * non-registry deps. Runs in every scan by default (offline, cheap). Individual
 * findings keep their scanner-core rule ids; this wrapper id is never a ship
 * blocker.
 *
 * See packages/scanner-core/src/supplyChain.ts for the product decision that
 * every `supply-*` finding is warning-only.
 */
export const supplyChainRules: Rule = {
  id: 'supply-chain',
  name: 'Install-time trust (npm allowScripts)',
  description:
    'Audits install-script allowlists, lockfile hasInstallScript packages, non-registry dependencies, and npm version pins — all from local project files.',
  severity: 'warning',

  async run(context: ProjectContext): Promise<Finding[]> {
    const packageJson = readProjectFile(context.projectPath, 'package.json');
    const packageLock = readProjectFile(context.projectPath, 'package-lock.json');
    // Project-root .npmrc only — never $HOME/.npmrc (auth tokens).
    const npmrc = readProjectFile(context.projectPath, '.npmrc');

    const workspacePackageJsons = context.files
      .map((file) => file.replace(/\\/g, '/'))
      .filter((file) => file !== 'package.json' && /(^|\/)package\.json$/.test(file))
      // Never read manifests under dependencies.
      .filter((file) => !file.includes('node_modules/'))
      .map((file) => {
        const content = readProjectFile(context.projectPath, file);
        if (content == null) return null;
        return { file, content };
      })
      .filter((entry): entry is { file: string; content: string } => entry !== null);

    const scan = scanSupplyChain({
      packageJson,
      packageLock,
      npmrc,
      workspacePackageJsons,
    });

    return scan.findings.map(toFinding);
  },
};
