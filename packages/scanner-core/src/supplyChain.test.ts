import { describe, expect, it } from 'vitest';
import { HIGH_CONFIDENCE_BLOCKER_RULE_IDS } from './blockerAllowlist';
import { buildShipGateReport } from './shipGate';
import {
  SUPPLY_ALLOWSCRIPTS_IN_WORKSPACE,
  SUPPLY_ALLOWSCRIPTS_INVALID,
  SUPPLY_ALLOWSCRIPTS_STALE,
  SUPPLY_ALLOWSCRIPTS_UNPINNED,
  SUPPLY_CHAIN_RULE_IDS,
  SUPPLY_INSTALL_SCRIPTS_UNREVIEWED,
  SUPPLY_NON_REGISTRY_DEPENDENCY,
  SUPPLY_NPM_BELOW_V12,
  classifyAllowScriptsKey,
  enginesNpmPermitsBelow12,
  isSupplyChainRuleId,
  packageNameFromLockKey,
  parsePackageManagerNpmMajor,
  readIgnoreScriptsFromNpmrc,
  scanSupplyChain,
} from './supplyChain';

const PLANTED_NPMRC_TOKEN = 'npm_planted_auth_token_DO_NOT_ECHO_9f3a2c1b';

function lockfileV3(packages: Record<string, Record<string, unknown>>): string {
  return JSON.stringify({
    name: 'fixture',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'fixture', version: '1.0.0' },
      ...packages,
    },
  });
}

function lockfileV2(packages: Record<string, Record<string, unknown>>): string {
  return JSON.stringify({
    name: 'fixture',
    lockfileVersion: 2,
    requires: true,
    packages: {
      '': { name: 'fixture', version: '1.0.0' },
      ...packages,
    },
    dependencies: {},
  });
}

function healthyMigratedProject(): {
  packageJson: string;
  packageLock: string;
  npmrc: string;
} {
  return {
    packageJson: JSON.stringify(
      {
        name: 'healthy',
        private: true,
        packageManager: 'npm@12.0.1',
        engines: { npm: '>=12' },
        allowScripts: {
          'esbuild@0.28.1': true,
          'sharp@0.34.5': true,
        },
        dependencies: {
          esbuild: '0.28.1',
          sharp: '0.34.5',
        },
      },
      null,
      2,
    ),
    packageLock: lockfileV3({
      'node_modules/esbuild': {
        version: '0.28.1',
        hasInstallScript: true,
        resolved: 'https://registry.npmjs.org/esbuild/-/esbuild-0.28.1.tgz',
      },
      'node_modules/sharp': {
        version: '0.34.5',
        hasInstallScript: true,
        resolved: 'https://registry.npmjs.org/sharp/-/sharp-0.34.5.tgz',
      },
      'node_modules/lodash': {
        version: '4.17.21',
        resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
      },
    }),
    npmrc: 'fund=false\n',
  };
}

describe('packageNameFromLockKey', () => {
  it('extracts bare, scoped, and nested names', () => {
    expect(packageNameFromLockKey('node_modules/esbuild')).toBe('esbuild');
    expect(packageNameFromLockKey('node_modules/@vscode/vsce-sign')).toBe('@vscode/vsce-sign');
    expect(packageNameFromLockKey('node_modules/playwright/node_modules/fsevents')).toBe(
      'fsevents',
    );
    expect(packageNameFromLockKey('')).toBeNull();
    expect(packageNameFromLockKey('packages/cli')).toBeNull();
  });
});

describe('classifyAllowScriptsKey', () => {
  it('classifies bare, wildcard, exact, and invalid shapes', () => {
    expect(classifyAllowScriptsKey('canvas').shape).toBe('bare');
    expect(classifyAllowScriptsKey('canvas@*').shape).toBe('wildcard');
    expect(classifyAllowScriptsKey('canvas@1.2.3').shape).toBe('exact');
    expect(classifyAllowScriptsKey('canvas@1.0.0||2.0.0').shape).toBe('exact');
    expect(classifyAllowScriptsKey('@scope/pkg@1.2.3').shape).toBe('exact');
    expect(classifyAllowScriptsKey('canvas@^1.0.0').shape).toBe('invalid');
    expect(classifyAllowScriptsKey('canvas@~1.0.0').shape).toBe('invalid');
    expect(classifyAllowScriptsKey('canvas@>=1.0.0').shape).toBe('invalid');
    expect(classifyAllowScriptsKey('canvas@<2.0.0').shape).toBe('invalid');
    expect(classifyAllowScriptsKey('canvas@latest').shape).toBe('invalid');
    expect(classifyAllowScriptsKey('canvas@next').shape).toBe('invalid');
  });
});

describe('npm version helpers', () => {
  it('parses packageManager npm majors', () => {
    expect(parsePackageManagerNpmMajor('npm@12.0.1')).toEqual({ major: 12, raw: 'npm@12.0.1' });
    expect(parsePackageManagerNpmMajor('npm@10.8.2')?.major).toBe(10);
    expect(parsePackageManagerNpmMajor('pnpm@9.0.0')).toBeNull();
    expect(parsePackageManagerNpmMajor(undefined)).toBeNull();
  });

  it('detects engines.npm ranges that permit npm < 12', () => {
    expect(enginesNpmPermitsBelow12('>=10')).toBe(true);
    expect(enginesNpmPermitsBelow12('^10.0.0')).toBe(true);
    expect(enginesNpmPermitsBelow12('10.8.2')).toBe(true);
    expect(enginesNpmPermitsBelow12('<12')).toBe(true);
    expect(enginesNpmPermitsBelow12('>=12')).toBe(false);
    expect(enginesNpmPermitsBelow12('>=12.0.0')).toBe(false);
    expect(enginesNpmPermitsBelow12('^12.0.0')).toBe(false);
  });
});

describe('readIgnoreScriptsFromNpmrc', () => {
  it('reads ignore-scripts without exposing other values', () => {
    expect(readIgnoreScriptsFromNpmrc('ignore-scripts=true\n')).toBe(true);
    expect(readIgnoreScriptsFromNpmrc('ignore-scripts=false\n')).toBe(false);
    expect(
      readIgnoreScriptsFromNpmrc(`//registry.npmjs.org/:_authToken=${PLANTED_NPMRC_TOKEN}`),
    ).toBe(undefined);
  });
});

describe('supply-install-scripts-unreviewed', () => {
  it('fires when lockfile has install scripts and there is no allowScripts', () => {
    const result = scanSupplyChain({
      packageJson: JSON.stringify({ name: 'app', private: true }),
      packageLock: lockfileV3({
        'node_modules/esbuild': { version: '0.28.1', hasInstallScript: true },
        'node_modules/sharp': { version: '0.34.5', hasInstallScript: true },
        'node_modules/lodash': { version: '4.17.21' },
      }),
    });
    const hit = result.findings.find((f) => f.ruleId === SUPPLY_INSTALL_SCRIPTS_UNREVIEWED);
    expect(hit).toMatchObject({ severity: 'warning', confidence: 'high' });
    expect(hit?.message).toMatch(/2 packages can run code at install time/);
    expect(hit?.suggestion).toMatch(/npm install-scripts --allow-scripts-pending/);
  });

  it('counts nested lockfile copies with hasInstallScript separately', () => {
    const result = scanSupplyChain({
      packageJson: JSON.stringify({ name: 'app', private: true }),
      packageLock: lockfileV3({
        'node_modules/fsevents': { version: '2.3.3', hasInstallScript: true },
        'node_modules/playwright/node_modules/fsevents': {
          version: '2.3.2',
          hasInstallScript: true,
        },
      }),
    });
    const hit = result.findings.find((f) => f.ruleId === SUPPLY_INSTALL_SCRIPTS_UNREVIEWED);
    expect(hit?.message).toMatch(/2 packages can run code at install time/);
  });

  it('is silent when allowScripts is present (even if empty)', () => {
    const result = scanSupplyChain({
      packageJson: JSON.stringify({ name: 'app', allowScripts: {} }),
      packageLock: lockfileV3({
        'node_modules/esbuild': { version: '0.28.1', hasInstallScript: true },
      }),
    });
    expect(result.findings.some((f) => f.ruleId === SUPPLY_INSTALL_SCRIPTS_UNREVIEWED)).toBe(false);
  });

  it('is silent when ignore-scripts=true in project .npmrc', () => {
    const result = scanSupplyChain({
      packageJson: JSON.stringify({ name: 'app' }),
      packageLock: lockfileV3({
        'node_modules/esbuild': { version: '0.28.1', hasInstallScript: true },
      }),
      npmrc: 'ignore-scripts=true\n',
    });
    expect(result.findings.some((f) => f.ruleId === SUPPLY_INSTALL_SCRIPTS_UNREVIEWED)).toBe(false);
  });

  it('supports lockfile v2', () => {
    const result = scanSupplyChain({
      packageJson: JSON.stringify({ name: 'app' }),
      packageLock: lockfileV2({
        'node_modules/esbuild': { version: '0.28.1', hasInstallScript: true },
      }),
    });
    expect(result.findings.some((f) => f.ruleId === SUPPLY_INSTALL_SCRIPTS_UNREVIEWED)).toBe(true);
  });

  it('yields no findings for missing lockfile, malformed JSON, or unknown lockfileVersion', () => {
    expect(scanSupplyChain({ packageJson: '{}', packageLock: null }).findings).toEqual([]);
    expect(scanSupplyChain({ packageJson: '{}', packageLock: '{not json' }).findings).toEqual([]);
    expect(
      scanSupplyChain({
        packageJson: '{}',
        packageLock: JSON.stringify({ lockfileVersion: 99, packages: {} }),
      }).findings,
    ).toEqual([]);
  });
});

describe('supply-allowscripts-unpinned', () => {
  it('flags bare names and name@*', () => {
    const packageJson = JSON.stringify(
      {
        name: 'app',
        allowScripts: { canvas: true, 'esbuild@*': true, 'sharp@0.34.5': true },
      },
      null,
      2,
    );
    const result = scanSupplyChain({
      packageJson,
      packageLock: lockfileV3({
        'node_modules/canvas': { version: '2.0.0', hasInstallScript: true },
        'node_modules/esbuild': { version: '0.28.1', hasInstallScript: true },
        'node_modules/sharp': { version: '0.34.5', hasInstallScript: true },
      }),
    });
    const unpinned = result.findings.filter((f) => f.ruleId === SUPPLY_ALLOWSCRIPTS_UNPINNED);
    expect(unpinned).toHaveLength(2);
    expect(unpinned.map((f) => f.message).join('\n')).toMatch(/canvas/);
    expect(unpinned.map((f) => f.message).join('\n')).toMatch(/esbuild@\*/);
  });

  it('accepts exact pins', () => {
    const healthy = healthyMigratedProject();
    const result = scanSupplyChain(healthy);
    expect(result.findings.some((f) => f.ruleId === SUPPLY_ALLOWSCRIPTS_UNPINNED)).toBe(false);
  });
});

describe('supply-allowscripts-stale', () => {
  it('flags allowScripts keys absent from the lockfile and cross-references slopsquat', () => {
    const result = scanSupplyChain({
      packageJson: JSON.stringify({
        name: 'app',
        allowScripts: { 'leftpad@1.0.0': true },
      }),
      packageLock: lockfileV3({
        'node_modules/esbuild': { version: '0.28.1', hasInstallScript: true },
      }),
    });
    const stale = result.findings.find((f) => f.ruleId === SUPPLY_ALLOWSCRIPTS_STALE);
    expect(stale).toBeDefined();
    expect(stale?.message).toMatch(/dep-slopsquat-suspect/);
    expect(stale?.suggestion).toMatch(/npm install-scripts prune/);
  });
});

describe('supply-allowscripts-invalid', () => {
  it('flags ranges and dist-tags npm will drop', () => {
    const result = scanSupplyChain({
      packageJson: JSON.stringify({
        name: 'app',
        allowScripts: {
          'canvas@^1.0.0': true,
          'esbuild@latest': true,
        },
      }),
      packageLock: lockfileV3({
        'node_modules/canvas': { version: '1.0.0', hasInstallScript: true },
        'node_modules/esbuild': { version: '0.28.1', hasInstallScript: true },
      }),
    });
    const invalid = result.findings.filter((f) => f.ruleId === SUPPLY_ALLOWSCRIPTS_INVALID);
    expect(invalid).toHaveLength(2);
    expect(invalid.every((f) => f.message.includes('silently drops'))).toBe(true);
  });
});

describe('supply-allowscripts-in-workspace', () => {
  it('flags allowScripts in a non-root workspace package.json', () => {
    const result = scanSupplyChain({
      packageJson: JSON.stringify({ name: 'root', workspaces: ['apps/*'] }),
      packageLock: lockfileV3({}),
      workspacePackageJsons: [
        {
          file: 'apps/web/package.json',
          content: JSON.stringify({ name: 'web', allowScripts: { 'esbuild@0.28.1': true } }),
        },
      ],
    });
    expect(result.findings.some((f) => f.ruleId === SUPPLY_ALLOWSCRIPTS_IN_WORKSPACE)).toBe(true);
    expect(result.findings.find((f) => f.ruleId === SUPPLY_ALLOWSCRIPTS_IN_WORKSPACE)?.file).toBe(
      'apps/web/package.json',
    );
  });
});

describe('supply-non-registry-dependency', () => {
  it('flags git and tarball specs from package.json without echoing URLs', () => {
    const tokenizedGit = `git+https://user:${PLANTED_NPMRC_TOKEN}@github.com/acme/pkg.git`;
    const result = scanSupplyChain({
      packageJson: JSON.stringify({
        name: 'app',
        dependencies: {
          evil: tokenizedGit,
          remote: 'https://example.com/pkg/-/pkg-1.0.0.tgz',
        },
      }),
      packageLock: lockfileV3({}),
    });
    const hits = result.findings.filter((f) => f.ruleId === SUPPLY_NON_REGISTRY_DEPENDENCY);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const blob = hits.map((f) => `${f.message}\n${f.suggestion ?? ''}`).join('\n');
    expect(blob).not.toContain(PLANTED_NPMRC_TOKEN);
    expect(blob).not.toContain('github.com/acme');
  });

  it('flags non-registry resolved URLs in the lockfile', () => {
    const result = scanSupplyChain({
      packageJson: JSON.stringify({ name: 'app', dependencies: { weird: '1.0.0' } }),
      packageLock: lockfileV3({
        'node_modules/weird': {
          version: '1.0.0',
          resolved: 'https://evil.example/pkg.tgz',
        },
      }),
    });
    expect(result.findings.some((f) => f.ruleId === SUPPLY_NON_REGISTRY_DEPENDENCY)).toBe(true);
  });
});

describe('supply-npm-below-v12', () => {
  it('flags packageManager npm below 12', () => {
    const result = scanSupplyChain({
      packageJson: JSON.stringify({ name: 'app', packageManager: 'npm@10.8.2' }),
      packageLock: lockfileV3({}),
    });
    expect(result.findings.some((f) => f.ruleId === SUPPLY_NPM_BELOW_V12)).toBe(true);
  });

  it('flags engines.npm that permit below 12', () => {
    const result = scanSupplyChain({
      packageJson: JSON.stringify({ name: 'app', engines: { npm: '>=10' } }),
      packageLock: lockfileV3({}),
    });
    expect(result.findings.some((f) => f.ruleId === SUPPLY_NPM_BELOW_V12)).toBe(true);
  });

  it('is silent when npm 12+ is pinned', () => {
    const healthy = healthyMigratedProject();
    const result = scanSupplyChain(healthy);
    expect(result.findings.some((f) => f.ruleId === SUPPLY_NPM_BELOW_V12)).toBe(false);
  });
});

describe('correctly migrated project', () => {
  it('produces zero findings', () => {
    const healthy = healthyMigratedProject();
    expect(scanSupplyChain(healthy).findings).toEqual([]);
  });
});

describe('malformed inputs never throw', () => {
  it('returns empty findings for garbage inputs', () => {
    expect(() =>
      scanSupplyChain({
        packageJson: '{',
        packageLock: 'null',
        npmrc: ':::::not-valid',
        workspacePackageJsons: [{ file: 'apps/x/package.json', content: 'nope' }],
      }),
    ).not.toThrow();
    expect(
      scanSupplyChain({
        packageJson: '{',
        packageLock: 'null',
        npmrc: ':::::not-valid',
      }).findings,
    ).toEqual([]);
  });
});

describe('supply chain never blocks ship', () => {
  it('does not list any supply-* id on the blocker allowlist', () => {
    const supplyIds = HIGH_CONFIDENCE_BLOCKER_RULE_IDS.filter((id) => id.startsWith('supply-'));
    expect(supplyIds).toEqual([]);
    for (const id of SUPPLY_CHAIN_RULE_IDS) {
      expect(HIGH_CONFIDENCE_BLOCKER_RULE_IDS).not.toContain(id);
    }
  });

  it('does not raise ship-gate status to blocked for supply-* findings', () => {
    const findings = scanSupplyChain({
      packageJson: JSON.stringify({
        name: 'app',
        packageManager: 'npm@10.8.2',
        allowScripts: { canvas: true, 'leftpad@1.0.0': true, 'esbuild@latest': true },
        dependencies: { evil: 'git+https://github.com/acme/pkg.git' },
      }),
      packageLock: lockfileV3({
        'node_modules/esbuild': { version: '0.28.1', hasInstallScript: true },
      }),
      workspacePackageJsons: [
        {
          file: 'packages/a/package.json',
          content: JSON.stringify({ name: 'a', allowScripts: { x: true } }),
        },
      ],
    }).findings;

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
    expect(findings.every((f) => isSupplyChainRuleId(f.ruleId))).toBe(true);

    const report = buildShipGateReport(findings);
    expect(report.blockers).toHaveLength(0);
    expect(report.status).not.toBe('blocked');
  });

  it('routes error+high supply findings to review, not blockers (shipGate defense)', () => {
    // Synthesize error+high the way a mistaken severity bump would look — the
    // product decision is warning-only, but shipGate must still refuse to block.
    const findings = [
      {
        ruleId: SUPPLY_INSTALL_SCRIPTS_UNREVIEWED,
        severity: 'error' as const,
        confidence: 'high' as const,
        file: 'package-lock.json',
        message: 'synthetic supply finding for ship-gate defense',
        suggestion: 'should not block',
      },
    ];
    const report = buildShipGateReport(findings);
    expect(report.blockers).toHaveLength(0);
    expect(report.reviews.length).toBeGreaterThan(0);
    expect(report.status).not.toBe('blocked');
  });
});

describe('.npmrc redaction', () => {
  it('never echoes an .npmrc auth token in any finding message', () => {
    const result = scanSupplyChain({
      packageJson: JSON.stringify({ name: 'app' }),
      packageLock: lockfileV3({
        'node_modules/esbuild': { version: '0.28.1', hasInstallScript: true },
      }),
      npmrc: [
        `//registry.npmjs.org/:_authToken=${PLANTED_NPMRC_TOKEN}`,
        '//elsewhere.example/:_authToken=also_secret_value_xyz',
        'ignore-scripts=false',
      ].join('\n'),
    });
    expect(result.findings.some((f) => f.ruleId === SUPPLY_INSTALL_SCRIPTS_UNREVIEWED)).toBe(true);
    const blob = result.findings.map((f) => `${f.message}\n${f.suggestion ?? ''}`).join('\n');
    expect(blob).not.toContain(PLANTED_NPMRC_TOKEN);
    expect(blob).not.toContain('also_secret_value_xyz');
    expect(blob).not.toContain('_authToken');
  });
});
