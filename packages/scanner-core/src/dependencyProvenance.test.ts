import { describe, expect, it } from 'vitest';
import { HIGH_CONFIDENCE_BLOCKER_RULE_IDS } from './blockerAllowlist';
import { buildShipGateReport } from './shipGate';
import {
  DEP_NEW_UNVETTED,
  DEP_NONEXISTENT_PACKAGE,
  DEP_REGISTRY_UNAVAILABLE,
  DEP_SCAN_CAPPED,
  DEP_SLOPSQUAT_SUSPECT,
  DEP_TYPOSQUAT_SUSPECT,
  diffAddedDependencies,
  evaluateDependencyProvenance,
  evaluateNewDependencies,
  findBorrowedCorpusName,
  isAbandonedShape,
  parsePackageJsonDependencies,
  scopeOwnsBorrowedName,
  tokenizePackageName,
} from './dependencyProvenance';
import { REACT_CODESHIFT_SIGNALS } from './fixtures/reactCodeshiftFixture';

const CORPUS = [
  'lodash',
  'react',
  'jscodeshift',
  'express',
  'axios',
  'next-auth',
  'supabase',
  'eslint',
  'babel',
  'node',
  'react-dom',
  'eslint-plugin-import',
  'babel-preset-env',
  '@types/node',
] as const;

describe('borrowed-name detection', () => {
  const corpusSet = new Set(CORPUS);

  it('tokenises on -, _, and .', () => {
    expect(tokenizePackageName('react-codeshift')).toEqual(['react', 'codeshift']);
    expect(tokenizePackageName('foo_bar.baz')).toEqual(['foo', 'bar', 'baz']);
  });

  it('detects single-token borrows', () => {
    expect(findBorrowedCorpusName('react-codeshift', corpusSet)?.name).toBe('react');
    expect(findBorrowedCorpusName('jscodeshift-utils', corpusSet)?.name).toBe('jscodeshift');
    expect(findBorrowedCorpusName('supabase-client-js', corpusSet)?.name).toBe('supabase');
  });

  it('detects contiguous-run borrows (next-auth over next)', () => {
    expect(findBorrowedCorpusName('next-auth-helpers', corpusSet)?.name).toBe('next-auth');
  });

  it('does not flag when the full name is itself a corpus entry', () => {
    expect(findBorrowedCorpusName('react-dom', corpusSet)).toBeNull();
    expect(findBorrowedCorpusName('eslint-plugin-import', corpusSet)).toBeNull();
  });

  it('does not flag scoped packages that own the borrowed name', () => {
    expect(scopeOwnsBorrowedName('@babel', 'babel')).toBe(true);
    // Name contains the token `babel`, but `@babel` owns it.
    expect(findBorrowedCorpusName('@babel/babel-helper', corpusSet)).toBeNull();
  });

  it('does flag scoped packages that borrow outside their scope', () => {
    // @types/node: full name is in corpus → no borrow. Use a non-corpus scoped name.
    expect(findBorrowedCorpusName('@evil/react-helper', corpusSet)?.name).toBe('react');
  });
});

describe('abandoned shape', () => {
  it('requires exactly one version AND no repository', () => {
    expect(isAbandonedShape(1, false)).toBe(true);
    expect(isAbandonedShape(1, true)).toBe(false);
    expect(isAbandonedShape(2, false)).toBe(false);
    expect(isAbandonedShape(null, false)).toBe(false);
  });
});

describe('dep-typosquat-suspect (renamed edit-distance rule)', () => {
  it('blocks lodahs / expres when young + low downloads + proximity', () => {
    for (const [pkg, neighbour] of [
      ['lodahs', 'lodash'],
      ['expres', 'express'],
    ] as const) {
      const finding = evaluateDependencyProvenance(
        {
          packageName: pkg,
          exists: true,
          ageDays: 3,
          weeklyDownloads: 12,
          versionCount: 5,
          hasRepository: true,
        },
        { corpus: CORPUS },
      );
      expect(finding?.ruleId).toBe(DEP_TYPOSQUAT_SUSPECT);
      expect(finding?.severity).toBe('error');
      expect(finding?.message).toContain(neighbour);
      expect(HIGH_CONFIDENCE_BLOCKER_RULE_IDS).toContain(DEP_TYPOSQUAT_SUSPECT);
    }
  });

  it('does not block a young package with real downloads (negative)', () => {
    const finding = evaluateDependencyProvenance(
      {
        packageName: 'lodahs',
        exists: true,
        ageDays: 1,
        weeklyDownloads: 250,
        versionCount: 1,
        hasRepository: false,
      },
      { corpus: CORPUS },
    );
    // Not typosquat (downloads healthy). May still be slopsquat if abandoned+borrowed —
    // lodahs does not borrow a corpus token, so null.
    expect(finding).toBeNull();
  });
});

describe('dep-slopsquat-suspect (borrowed + abandoned + low downloads)', () => {
  const abandonedLow = {
    exists: true as const,
    weeklyDownloads: 5,
    versionCount: 1,
    hasRepository: false as const,
  };

  it('blocks react-codeshift / jscodeshift-utils / next-auth-helpers / supabase-client-js at any age', () => {
    for (const pkg of [
      'react-codeshift',
      'jscodeshift-utils',
      'next-auth-helpers',
      'supabase-client-js',
    ]) {
      for (const ageDays of [5, 200, 500]) {
        const finding = evaluateDependencyProvenance(
          { packageName: pkg, ageDays, ...abandonedLow },
          { corpus: CORPUS },
        );
        expect(finding?.ruleId, `${pkg} @ ${ageDays}d`).toBe(DEP_SLOPSQUAT_SUSPECT);
        expect(finding?.severity).toBe('error');
        expect(finding?.confidence).toBe('high');
        expect(finding?.message).toMatch(/slopsquat|borrows/i);
      }
    }
  });

  it('age is not a factor — identical verdict at 5d and 500d', () => {
    const a = evaluateDependencyProvenance(
      { packageName: 'react-codeshift', ageDays: 5, ...abandonedLow },
      { corpus: CORPUS },
    );
    const b = evaluateDependencyProvenance(
      { packageName: 'react-codeshift', ageDays: 500, ...abandonedLow },
      { corpus: CORPUS },
    );
    expect(a?.ruleId).toBe(b?.ruleId);
    expect(a?.severity).toBe(b?.severity);
    expect(a?.message).toBe(b?.message);
  });

  it('warns when borrowed + exactly one of abandoned/low', () => {
    const borrowedLowOnly = evaluateDependencyProvenance(
      {
        packageName: 'react-codeshift',
        exists: true,
        ageDays: 400,
        weeklyDownloads: 5,
        versionCount: 12,
        hasRepository: true,
      },
      { corpus: CORPUS },
    );
    expect(borrowedLowOnly?.ruleId).toBe(DEP_SLOPSQUAT_SUSPECT);
    expect(borrowedLowOnly?.severity).toBe('warning');

    const borrowedAbandonedOnly = evaluateDependencyProvenance(
      {
        packageName: 'react-codeshift',
        exists: true,
        ageDays: 400,
        weeklyDownloads: 50_000,
        versionCount: 1,
        hasRepository: false,
      },
      { corpus: CORPUS },
    );
    expect(borrowedAbandonedOnly?.ruleId).toBe(DEP_SLOPSQUAT_SUSPECT);
    expect(borrowedAbandonedOnly?.severity).toBe('warning');
  });

  it('emits nothing when borrowed alone', () => {
    const finding = evaluateDependencyProvenance(
      {
        packageName: 'react-something-unique',
        exists: true,
        ageDays: 400,
        weeklyDownloads: 50_000,
        versionCount: 20,
        hasRepository: true,
      },
      { corpus: CORPUS },
    );
    expect(finding).toBeNull();
  });

  it('does NOT block legitimate borrowed-token packages', () => {
    const legit: Array<{ name: string; downloads: number; versions: number }> = [
      { name: 'eslint-plugin-import', downloads: 10_000_000, versions: 80 },
      { name: '@types/node', downloads: 50_000_000, versions: 200 },
      { name: 'babel-preset-env', downloads: 5_000_000, versions: 40 },
      { name: 'react-dom', downloads: 20_000_000, versions: 100 },
    ];
    for (const pkg of legit) {
      const finding = evaluateDependencyProvenance(
        {
          packageName: pkg.name,
          exists: true,
          ageDays: 4000,
          weeklyDownloads: pkg.downloads,
          versionCount: pkg.versions,
          hasRepository: true,
        },
        { corpus: CORPUS },
      );
      expect(finding, pkg.name).toBeNull();
      expect(finding?.severity === 'error').toBeFalsy();
    }
  });
});

describe('acceptance: react-codeshift from captured registry fixture', () => {
  it('produces a blocker naming the reason from real captured metadata', () => {
    const finding = evaluateDependencyProvenance(REACT_CODESHIFT_SIGNALS);
    expect(finding).not.toBeNull();
    expect(finding!.ruleId).toBe(DEP_SLOPSQUAT_SUSPECT);
    expect(finding!.severity).toBe('error');
    expect(finding!.confidence).toBe('high');
    expect(finding!.message).toContain('react-codeshift');
    expect(finding!.message).toMatch(/borrows|slopsquat/i);
    expect(finding!.message).toMatch(/react/);
    expect(finding!.message).toMatch(/one published version|no repository/i);

    const gate = buildShipGateReport([finding!], { scannedFileCount: 1 });
    expect(gate.status).toBe('blocked');
    expect(HIGH_CONFIDENCE_BLOCKER_RULE_IDS).toContain(DEP_SLOPSQUAT_SUSPECT);
  });
});

describe('evaluateDependencyProvenance — other rules unchanged', () => {
  it('blocks nonexistent packages (404)', () => {
    const finding = evaluateDependencyProvenance({
      packageName: 'totally-missing-pkg-xyz',
      exists: false,
      ageDays: null,
      weeklyDownloads: null,
    });
    expect(finding?.ruleId).toBe(DEP_NONEXISTENT_PACKAGE);
  });

  it('warns on registry unavailable', () => {
    const finding = evaluateDependencyProvenance({
      packageName: 'anything',
      exists: null,
      ageDays: null,
      weeklyDownloads: null,
    });
    expect(finding?.ruleId).toBe(DEP_REGISTRY_UNAVAILABLE);
    expect(finding?.severity).toBe('warning');
  });

  it('warns dep-new-unvetted for young + low without borrow/typo', () => {
    const finding = evaluateDependencyProvenance(
      {
        packageName: 'totally-unique-brand-new-pkg-xyz',
        exists: true,
        ageDays: 2,
        weeklyDownloads: 4,
        versionCount: 3,
        hasRepository: true,
      },
      { corpus: CORPUS },
    );
    expect(finding?.ruleId).toBe(DEP_NEW_UNVETTED);
    expect(finding?.severity).toBe('warning');
  });
});

describe('evaluateNewDependencies', () => {
  it('emits a cap warning when too many new deps are added', () => {
    const signals = Array.from({ length: 5 }, (_, i) => ({
      packageName: `pkg-${i}`,
      exists: false as const,
      ageDays: null,
      weeklyDownloads: null,
    }));
    const scan = evaluateNewDependencies(signals, { cap: 2 });
    expect(scan.findings.some((f) => f.ruleId === DEP_SCAN_CAPPED)).toBe(true);
    expect(scan.findings.filter((f) => f.ruleId === DEP_NONEXISTENT_PACKAGE)).toHaveLength(2);
  });
});

describe('diffAddedDependencies / parse', () => {
  it('returns only newly added names', () => {
    const added = diffAddedDependencies(
      { dependencies: { react: '^18.0.0', lodash: '^4.0.0' } },
      {
        dependencies: { react: '^18.0.0', lodash: '^4.0.0', 'react-codeshift': '^1.0.0' },
        devDependencies: { vitest: '^1.0.0' },
      },
    );
    expect(added).toEqual(['react-codeshift', 'vitest']);
  });

  it('parses a valid manifest', () => {
    const parsed = parsePackageJsonDependencies(
      JSON.stringify({ dependencies: { react: '18.0.0' } }),
    );
    expect(parsed?.dependencies?.react).toBe('18.0.0');
  });
});
