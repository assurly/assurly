import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { scanProjectDirectory } from './scanProject';

describe('supply chain end-to-end via scanProjectDirectory', () => {
  it('surfaces install-script trust findings through the real orchestration path', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assurly-supply-e2e-'));
    try {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(
          {
            name: 'supply-e2e-fixture',
            private: true,
            packageManager: 'npm@10.8.2',
            dependencies: {
              esbuild: '0.28.1',
            },
          },
          null,
          2,
        ),
        'utf8',
      );
      fs.writeFileSync(
        path.join(tempDir, 'package-lock.json'),
        JSON.stringify(
          {
            name: 'supply-e2e-fixture',
            lockfileVersion: 3,
            requires: true,
            packages: {
              '': { name: 'supply-e2e-fixture', version: '1.0.0' },
              'node_modules/esbuild': {
                version: '0.28.1',
                hasInstallScript: true,
                resolved: 'https://registry.npmjs.org/esbuild/-/esbuild-0.28.1.tgz',
              },
            },
          },
          null,
          2,
        ),
        'utf8',
      );
      fs.writeFileSync(
        path.join(tempDir, '.npmrc'),
        `//registry.npmjs.org/:_authToken=npm_e2e_planted_token_NEVER_ECHO\n`,
        'utf8',
      );

      const result = await scanProjectDirectory(tempDir, { supplyOnly: true });
      const ruleIds = new Set(result.findings.map((finding) => finding.ruleId));

      expect(ruleIds.has('supply-install-scripts-unreviewed')).toBe(true);
      expect(ruleIds.has('supply-npm-below-v12')).toBe(true);
      expect(JSON.stringify(result.findings)).not.toContain('npm_e2e_planted_token_NEVER_ECHO');
      expect(result.findings.every((f) => f.severity === 'warning')).toBe(true);
      expect(result.report.blockers).toHaveLength(0);
      expect(result.report.status).not.toBe('blocked');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('is silent for a correctly migrated project', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assurly-supply-clean-'));
    try {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(
          {
            name: 'supply-clean',
            private: true,
            packageManager: 'npm@12.0.1',
            engines: { npm: '>=12' },
            allowScripts: { 'esbuild@0.28.1': true },
            dependencies: { esbuild: '0.28.1' },
          },
          null,
          2,
        ),
        'utf8',
      );
      fs.writeFileSync(
        path.join(tempDir, 'package-lock.json'),
        JSON.stringify(
          {
            name: 'supply-clean',
            lockfileVersion: 3,
            requires: true,
            packages: {
              '': { name: 'supply-clean', version: '1.0.0' },
              'node_modules/esbuild': {
                version: '0.28.1',
                hasInstallScript: true,
                resolved: 'https://registry.npmjs.org/esbuild/-/esbuild-0.28.1.tgz',
              },
            },
          },
          null,
          2,
        ),
        'utf8',
      );

      const result = await scanProjectDirectory(tempDir, { supplyOnly: true });
      expect(result.findings.filter((f) => f.ruleId.startsWith('supply-'))).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
