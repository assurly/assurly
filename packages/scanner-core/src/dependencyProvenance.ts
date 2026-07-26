/**
 * Dependency provenance guard — typosquat + slopsquat + young-unvetted.
 *
 * Evaluates *newly added* dependencies against registry signals. Pure: callers
 * supply metadata. Network I/O and caching live in the web app (webhook path).
 *
 * Blocking policy (near-certainty only):
 *   - dep-nonexistent-package → blocker (404 / never published)
 *   - dep-typosquat-suspect   → blocker (age < 30d AND downloads < 100 AND
 *                                edit distance ≤ 2 from a top-corpus name)
 *   - dep-slopsquat-suspect   → blocker (borrows a corpus name AND abandoned
 *                                shape AND low downloads). Age is NOT a factor.
 *   - dep-new-unvetted        → warning (young + low downloads, no other hit)
 *   - dep-registry-unavailable → warning (lookup failed; never blocks)
 *
 * Slopsquat ≠ typosquat. LLMs invent plausible compounds (`react-codeshift`,
 * `jscodeshift-utils`); edit distance cannot find those without drowning in
 * false positives. The abandoned registry shape (one version, no repository)
 * plus borrowed naming is what carries precision.
 */
import type { FindingConfidence as Confidence, ScannerFinding, Severity } from './index';
import { findNearestCorpusMatch } from './editDistance';
import { TOP_NPM_PACKAGE_NAMES, TOP_NPM_PACKAGE_NAME_SET } from './data/topNpmPackages';

export const DEP_NONEXISTENT_PACKAGE = 'dep-nonexistent-package';
/** Edit-distance lookalike (was mislabelled dep-slopsquat-suspect). */
export const DEP_TYPOSQUAT_SUSPECT = 'dep-typosquat-suspect';
/** Borrowed name + abandoned registry shape + low downloads. */
export const DEP_SLOPSQUAT_SUSPECT = 'dep-slopsquat-suspect';
export const DEP_NEW_UNVETTED = 'dep-new-unvetted';
export const DEP_REGISTRY_UNAVAILABLE = 'dep-registry-unavailable';
export const DEP_SCAN_CAPPED = 'dep-scan-capped';

/** Age threshold for "young" packages (days) — typosquat + new-unvetted only. */
export const DEP_YOUNG_AGE_DAYS = 30;
/** Weekly download floor below which adoption is "low". */
export const DEP_LOW_DOWNLOADS = 100;
/** Max Damerau-Levenshtein distance for typosquat proximity. */
export const DEP_PROXIMITY_MAX_DISTANCE = 2;
/** Default cap on new dependencies evaluated per PR. */
export const DEP_DEFAULT_EVAL_CAP = 40;

export interface DependencyProvenanceSignals {
  /** Package name as declared in the manifest (unscoped or scoped). */
  packageName: string;
  /** Manifest path the dependency was added in (e.g. package.json). */
  file?: string;
  /**
   * Registry existence. `true` = published, `false` = 404 / never published,
   * `null` = lookup failed / timed out / unavailable.
   */
  exists: boolean | null;
  /** Days since `time.created` on the registry document; null when unknown. */
  ageDays: number | null;
  /** Weekly download count; null when unknown. */
  weeklyDownloads: number | null;
  /**
   * Number of published versions on the registry document; null when unknown.
   * Used for the slopsquat "abandoned shape" signal.
   */
  versionCount?: number | null;
  /**
   * Whether the registry document has a `repository` field; null when unknown.
   * Used for the slopsquat "abandoned shape" signal.
   */
  hasRepository?: boolean | null;
  /**
   * Optional precomputed nearest corpus match (typosquat). When omitted, the
   * evaluator runs proximity against the bundled top-package corpus.
   */
  nearestMatch?: { name: string; distance: number } | null;
  /**
   * Optional precomputed borrowed corpus name (slopsquat). When omitted, the
   * evaluator runs token/run matching against the corpus. `null` means
   * "computed — no borrow"; `undefined` means "compute it".
   */
  borrowedName?: string | null;
}

export interface DependencyProvenanceScanResult {
  errorCount: number;
  warningCount: number;
  findings: ScannerFinding[];
}

export interface BorrowedNameMatch {
  /** The corpus entry that was borrowed (token or contiguous run). */
  name: string;
}

type ScanResult = DependencyProvenanceScanResult;

const result = (findings: ScannerFinding[]): ScanResult => ({
  errorCount: findings.filter((finding) => finding.severity === 'error').length,
  warningCount: findings.filter((finding) => finding.severity === 'warning').length,
  findings,
});

function finding(
  ruleId: string,
  severity: Severity,
  confidence: Confidence,
  file: string,
  message: string,
  suggestion: string,
): ScannerFinding {
  return { ruleId, severity, confidence, file, line: 1, message, suggestion };
}

function resolveNearestMatch(
  packageName: string,
  nearestMatch: DependencyProvenanceSignals['nearestMatch'],
  corpus: readonly string[],
): { name: string; distance: number } | null {
  if (nearestMatch !== undefined) return nearestMatch;
  return findNearestCorpusMatch(packageName, corpus, DEP_PROXIMITY_MAX_DISTANCE);
}

/**
 * Splits an unscoped package name into tokens on `-`, `_`, and `.`.
 * Empty tokens are dropped.
 */
export function tokenizePackageName(unscopedName: string): string[] {
  return unscopedName
    .toLowerCase()
    .split(/[-_.]+/)
    .filter((token) => token.length > 0);
}

/**
 * Contiguous token runs of length ≥ 1, joined with `-` (npm's dominant
 * separator). Longer runs are preferred by the caller when matching.
 */
export function contiguousTokenRuns(tokens: readonly string[]): string[] {
  const runs: string[] = [];
  for (let start = 0; start < tokens.length; start += 1) {
    for (let end = start + 1; end <= tokens.length; end += 1) {
      runs.push(tokens.slice(start, end).join('-'));
    }
  }
  // Prefer longer runs first so `next-auth` wins over `next` alone.
  return runs.sort((a, b) => b.length - a.length || a.localeCompare(b));
}

function parseScopedName(packageName: string): { scope: string | null; name: string } {
  const normalized = packageName.trim().toLowerCase();
  if (normalized.startsWith('@')) {
    const slash = normalized.indexOf('/');
    if (slash > 1) {
      return {
        scope: normalized.slice(0, slash),
        name: normalized.slice(slash + 1),
      };
    }
  }
  return { scope: null, name: normalized };
}

/**
 * True when a scoped package's scope "owns" the borrowed corpus name —
 * e.g. `@babel/plugin-x` borrowing `babel`. Unscoped packages never own.
 */
export function scopeOwnsBorrowedName(scope: string | null, borrowed: string): boolean {
  if (!scope) return false;
  const scopeBody = scope.startsWith('@') ? scope.slice(1) : scope;
  return scopeBody === borrowed.toLowerCase();
}

/**
 * Finds a borrowed corpus name inside `packageName` via exact token or
 * contiguous-run match. Returns null when the full name is itself a corpus
 * entry, or when the only borrows are owned by the package's own scope.
 */
export function findBorrowedCorpusName(
  packageName: string,
  corpusSet: ReadonlySet<string> = TOP_NPM_PACKAGE_NAME_SET,
): BorrowedNameMatch | null {
  const { scope, name } = parseScopedName(packageName);
  const fullName = scope ? `${scope}/${name}` : name;
  if (!name) return null;
  if (corpusSet.has(fullName) || corpusSet.has(name)) return null;

  const tokens = tokenizePackageName(name);
  if (tokens.length === 0) return null;

  for (const run of contiguousTokenRuns(tokens)) {
    if (!corpusSet.has(run)) continue;
    if (scopeOwnsBorrowedName(scope, run)) continue;
    return { name: run };
  }
  return null;
}

function resolveBorrowedName(
  packageName: string,
  borrowedName: DependencyProvenanceSignals['borrowedName'],
  corpusSet: ReadonlySet<string>,
): string | null {
  if (borrowedName !== undefined) return borrowedName;
  return findBorrowedCorpusName(packageName, corpusSet)?.name ?? null;
}

/** Abandoned shape: exactly one published version and no repository field. */
export function isAbandonedShape(
  versionCount: number | null | undefined,
  hasRepository: boolean | null | undefined,
): boolean {
  return versionCount === 1 && hasRepository === false;
}

/**
 * Evaluates one newly added dependency against registry signals.
 * Returns zero or one finding — never invents a signal that wasn't supplied.
 */
export function evaluateDependencyProvenance(
  signals: DependencyProvenanceSignals,
  options: { corpus?: readonly string[] } = {},
): ScannerFinding | null {
  const file = signals.file ?? 'package.json';
  const name = signals.packageName.trim();
  if (!name) return null;

  if (signals.exists === null) {
    return finding(
      DEP_REGISTRY_UNAVAILABLE,
      'warning',
      'medium',
      file,
      `Could not verify npm registry metadata for '${name}' (lookup failed or timed out).`,
      'Retry the check later, or confirm the package exists at registry.npmjs.org before merging.',
    );
  }

  if (signals.exists === false) {
    return finding(
      DEP_NONEXISTENT_PACKAGE,
      'error',
      'high',
      file,
      `Newly added dependency '${name}' does not exist on the npm registry — it has never been published.`,
      `Remove '${name}' or replace it with a real package. AI models sometimes hallucinate plausible package names.`,
    );
  }

  const corpus = options.corpus ?? TOP_NPM_PACKAGE_NAMES;
  const corpusSet: ReadonlySet<string> =
    options.corpus !== undefined
      ? new Set(options.corpus.map((entry) => entry.toLowerCase()))
      : TOP_NPM_PACKAGE_NAME_SET;

  const ageDays = signals.ageDays;
  const downloads = signals.weeklyDownloads;
  const young = ageDays !== null && ageDays < DEP_YOUNG_AGE_DAYS;
  const lowDownloads = downloads !== null && downloads < DEP_LOW_DOWNLOADS;

  // --- Typosquat (edit distance): keep prior logic, renamed --------------------
  if (young && lowDownloads) {
    const nearest = resolveNearestMatch(name, signals.nearestMatch, corpus);
    if (nearest && nearest.distance <= DEP_PROXIMITY_MAX_DISTANCE) {
      return finding(
        DEP_TYPOSQUAT_SUSPECT,
        'error',
        'high',
        file,
        `Newly added dependency '${name}' looks like a typosquat: published ${ageDays} day(s) ago, only ${downloads} download(s) last week, and within edit distance ${nearest.distance} of popular package '${nearest.name}'.`,
        `Verify '${name}' is the intended package. If you meant '${nearest.name}', fix the name. Do not install an unfamiliar package that closely matches a popular one.`,
      );
    }
  }

  // --- Slopsquat (borrowed name + abandoned shape + low downloads) ------------
  // Age is deliberately NOT a factor — pre-registered squats wait out any window.
  const borrowed = resolveBorrowedName(name, signals.borrowedName, corpusSet);
  if (borrowed) {
    const abandoned = isAbandonedShape(signals.versionCount, signals.hasRepository);
    const extras = [abandoned, lowDownloads].filter(Boolean).length;

    if (abandoned && lowDownloads) {
      return finding(
        DEP_SLOPSQUAT_SUSPECT,
        'error',
        'high',
        file,
        `Newly added dependency '${name}' looks like a slopsquat: it borrows the popular name '${borrowed}', has only one published version with no repository, and only ${downloads} download(s) last week.`,
        `Verify '${name}' is the package you intended. AI models often invent plausible names that attackers (or defensive placeholders) pre-register. Prefer the real package behind '${borrowed}'.`,
      );
    }

    if (extras === 1) {
      const reason = abandoned
        ? 'has only one published version with no repository'
        : `has only ${downloads} download(s) last week`;
      return finding(
        DEP_SLOPSQUAT_SUSPECT,
        'warning',
        'medium',
        file,
        `Newly added dependency '${name}' borrows the popular name '${borrowed}' and ${reason}.`,
        `Confirm the publisher and source before merging. Borrowed names with thin provenance deserve a second look.`,
      );
    }
    // borrowed only → no finding (ecosystem naming conventions are full of this)
  }

  // --- Young + low, no typosquat / slopsquat hit ------------------------------
  if (young && lowDownloads) {
    return finding(
      DEP_NEW_UNVETTED,
      'warning',
      'medium',
      file,
      `Newly added dependency '${name}' is young (${ageDays} day(s) old) with only ${downloads} download(s) last week.`,
      'Confirm the package publisher and source before merging. New packages with little adoption deserve a second look.',
    );
  }

  return null;
}

/**
 * Evaluates a list of newly added dependencies. Caps evaluation count; when
 * more packages are added than the cap, emits a single warning naming the
 * overflow count and still evaluates the first `cap` entries.
 */
export function evaluateNewDependencies(
  signalsList: readonly DependencyProvenanceSignals[],
  options: { corpus?: readonly string[]; cap?: number } = {},
): ScanResult {
  const cap = options.cap ?? DEP_DEFAULT_EVAL_CAP;
  const findings: ScannerFinding[] = [];

  if (signalsList.length > cap) {
    findings.push(
      finding(
        DEP_SCAN_CAPPED,
        'warning',
        'medium',
        signalsList[0]?.file ?? 'package.json',
        `This PR adds ${signalsList.length} new dependencies; only the first ${cap} were provenance-checked.`,
        'Split large dependency upgrades into smaller PRs, or review the remaining packages manually.',
      ),
    );
  }

  for (const signals of signalsList.slice(0, cap)) {
    const evaluated = evaluateDependencyProvenance(signals, {
      corpus: options.corpus,
    });
    if (evaluated) findings.push(evaluated);
  }

  return result(findings);
}

export interface PackageJsonDependencies {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** Merges production + dev dependency names from a package.json shape. */
export function collectDependencyNames(manifest: PackageJsonDependencies): Set<string> {
  const names = new Set<string>();
  for (const section of [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
  ] as const) {
    if (!section || typeof section !== 'object') continue;
    for (const key of Object.keys(section)) {
      if (key.trim()) names.add(key.trim());
    }
  }
  return names;
}

/**
 * Returns package names present in `head` but absent from `base`.
 * Peer dependencies are ignored — they are not installed by the consumer.
 */
export function diffAddedDependencies(
  baseManifest: PackageJsonDependencies | null,
  headManifest: PackageJsonDependencies,
): string[] {
  const baseNames = baseManifest ? collectDependencyNames(baseManifest) : new Set<string>();
  const headNames = collectDependencyNames(headManifest);
  const added: string[] = [];
  for (const depName of headNames) {
    if (!baseNames.has(depName)) added.push(depName);
  }
  return added.sort((a, b) => a.localeCompare(b));
}

/**
 * Parses package.json text into a dependency shape. Returns null on malformed
 * JSON or a non-object root — callers treat that as "no manifest".
 */
export function parsePackageJsonDependencies(content: string): PackageJsonDependencies | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as PackageJsonDependencies;
  } catch {
    return null;
  }
}

/** Bundled corpus accessor for callers that need proximity without importing data. */
export function getTopNpmPackageCorpus(): readonly string[] {
  return TOP_NPM_PACKAGE_NAMES;
}
