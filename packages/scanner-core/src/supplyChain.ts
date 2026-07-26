/**
 * Install-time trust audit — `supply-*` rules.
 *
 * Audits the npm 12+ install-script allowlist (`allowScripts`) and related
 * local trust artefacts. Everything is derived from project files already on
 * disk: package.json, package-lock.json, and project-root `.npmrc`. No network,
 * no registry calls, no telemetry.
 *
 * PRODUCT DECISION (do not "helpfully" reverse):
 * Every rule here is `severity: 'warning'`. Nothing blocks ship, and no
 * `supply-*` id belongs on `HIGH_CONFIDENCE_BLOCKER_RULE_IDS`. npm 12 landed
 * days ago; most real projects will surface several of these on the first scan
 * because nobody has migrated yet. A gate that fails everyone's build in week
 * one gets uninstalled in week one. `shipGate` also routes any `supply-*`
 * finding away from blockers as defense in depth (the `agent-*` precedent:
 * keeping ids off the allowlist alone turned out not to be sufficient).
 *
 * Safety rails:
 * - Never echo `.npmrc` values (auth tokens live there) — read only the
 *   settings needed and never include their values in findings.
 * - Never read outside the project root (callers pass project-local content).
 * - Malformed / missing / unknown lockfileVersion → zero findings, never throw.
 * - Do not overclaim: this audits trust decisions written down in the project;
 *   it does not inspect package code.
 */
// Type-only import: avoids a runtime circular dependency with index.ts.
import type { FindingConfidence as Confidence, ScannerFinding, Severity } from './index';

export const SUPPLY_INSTALL_SCRIPTS_UNREVIEWED = 'supply-install-scripts-unreviewed';
export const SUPPLY_ALLOWSCRIPTS_UNPINNED = 'supply-allowscripts-unpinned';
export const SUPPLY_ALLOWSCRIPTS_STALE = 'supply-allowscripts-stale';
export const SUPPLY_ALLOWSCRIPTS_INVALID = 'supply-allowscripts-invalid';
export const SUPPLY_ALLOWSCRIPTS_IN_WORKSPACE = 'supply-allowscripts-in-workspace';
export const SUPPLY_NON_REGISTRY_DEPENDENCY = 'supply-non-registry-dependency';
export const SUPPLY_NPM_BELOW_V12 = 'supply-npm-below-v12';

/** All `supply-*` rule ids emitted by this module. */
export const SUPPLY_CHAIN_RULE_IDS = [
  SUPPLY_INSTALL_SCRIPTS_UNREVIEWED,
  SUPPLY_ALLOWSCRIPTS_UNPINNED,
  SUPPLY_ALLOWSCRIPTS_STALE,
  SUPPLY_ALLOWSCRIPTS_INVALID,
  SUPPLY_ALLOWSCRIPTS_IN_WORKSPACE,
  SUPPLY_NON_REGISTRY_DEPENDENCY,
  SUPPLY_NPM_BELOW_V12,
] as const;

export type SupplyChainRuleId = (typeof SUPPLY_CHAIN_RULE_IDS)[number];

export interface SupplyChainScanResult {
  errorCount: number;
  warningCount: number;
  findings: ScannerFinding[];
}

export interface WorkspacePackageJsonInput {
  /** Project-relative path (posix), e.g. `apps/web/package.json`. */
  file: string;
  content: string;
}

/**
 * Pure inputs for the install-time trust audit. Callers read files from the
 * project root only; this module never touches the filesystem.
 */
export interface SupplyChainScanInput {
  /** Root `package.json` contents, or null/undefined when missing. */
  packageJson?: string | null;
  /** Root `package-lock.json` contents, or null/undefined when missing. */
  packageLock?: string | null;
  /** Project-root `.npmrc` only — never `$HOME/.npmrc`. */
  npmrc?: string | null;
  /** Non-root workspace `package.json` files (for allowScripts-in-workspace). */
  workspacePackageJsons?: readonly WorkspacePackageJsonInput[];
}

type ScanResult = SupplyChainScanResult;

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
  line: number | undefined,
  message: string,
  suggestion: string,
): ScannerFinding {
  return { ruleId, severity, confidence, file, line, message, suggestion };
}

/** True when `ruleId` is a supply-chain install-time trust rule. */
export function isSupplyChainRuleId(ruleId: string | undefined): boolean {
  return typeof ruleId === 'string' && ruleId.startsWith('supply-');
}

function parseJsonObject(content: string | null | undefined): Record<string, unknown> | null {
  if (content == null || content.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function lineNumberOfSubstring(content: string, substring: string): number | undefined {
  const idx = content.indexOf(substring);
  if (idx === -1) return undefined;
  return content.slice(0, idx).split(/\r?\n/).length;
}

/**
 * Reads `ignore-scripts` from project-root `.npmrc` only.
 * Never returns or echoes any other setting value (auth tokens live here).
 */
export function readIgnoreScriptsFromNpmrc(npmrc: string | null | undefined): boolean | undefined {
  if (npmrc == null || npmrc === '') return undefined;
  for (const rawLine of npmrc.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    // Strip inline comments carefully: only `#` / `;` preceded by whitespace.
    const withoutComment = line.replace(/\s+[;#].*$/, '');
    const match = /^ignore-scripts\s*=\s*(.*?)\s*$/i.exec(withoutComment);
    if (!match) continue;
    const raw = (match[1] ?? '').trim().toLowerCase();
    if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on') return true;
    if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') return false;
    return undefined;
  }
  return undefined;
}

interface LockPackageEntry {
  name: string;
  version: string | undefined;
  hasInstallScript: boolean;
  resolved: string | undefined;
}

interface ParsedLockfile {
  lockfileVersion: number;
  packages: LockPackageEntry[];
  packageNames: Set<string>;
}

/**
 * Extract the package name from a lockfile `packages` key
 * (`node_modules/foo`, `node_modules/@scope/pkg`, nested copies).
 */
export function packageNameFromLockKey(key: string): string | null {
  if (!key) return null;
  const marker = 'node_modules/';
  const idx = key.lastIndexOf(marker);
  if (idx === -1) return null;
  const rest = key.slice(idx + marker.length);
  if (!rest) return null;
  if (rest.startsWith('@')) {
    const parts = rest.split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return `${parts[0]}/${parts[1]}`;
  }
  const name = rest.split('/')[0];
  return name || null;
}

function parseLockfile(content: string | null | undefined): ParsedLockfile | null {
  const root = parseJsonObject(content);
  if (!root) return null;

  const versionRaw = root.lockfileVersion;
  if (typeof versionRaw !== 'number' || !Number.isFinite(versionRaw)) return null;
  // npm lockfile v2 and v3 both carry a `packages` map with hasInstallScript.
  if (versionRaw !== 2 && versionRaw !== 3) return null;

  const packagesNode = root.packages;
  if (!packagesNode || typeof packagesNode !== 'object' || Array.isArray(packagesNode)) {
    return null;
  }

  const packages: LockPackageEntry[] = [];
  const packageNames = new Set<string>();

  for (const [key, raw] of Object.entries(packagesNode as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const nameFromKey = packageNameFromLockKey(key);
    const nameFromField = typeof entry.name === 'string' ? entry.name : null;
    const name = nameFromKey ?? nameFromField;
    if (!name) continue;

    packageNames.add(name);
    packages.push({
      name,
      version: typeof entry.version === 'string' ? entry.version : undefined,
      hasInstallScript: entry.hasInstallScript === true,
      resolved: typeof entry.resolved === 'string' ? entry.resolved : undefined,
    });
  }

  return { lockfileVersion: versionRaw, packages, packageNames };
}

interface AllowScriptsEntry {
  key: string;
  packageName: string;
  /** bare | wildcard | exact | invalid */
  shape: 'bare' | 'wildcard' | 'exact' | 'invalid';
}

/**
 * Split an allowScripts / dependency key into package name + version part.
 * Handles scoped names (`@scope/pkg@1.0.0`).
 */
export function splitPackageSpec(spec: string): { name: string; versionPart: string | null } {
  const trimmed = spec.trim();
  if (!trimmed) return { name: '', versionPart: null };

  if (trimmed.startsWith('@')) {
    const slash = trimmed.indexOf('/');
    if (slash === -1) return { name: trimmed, versionPart: null };
    const afterScope = trimmed.slice(slash + 1);
    const at = afterScope.indexOf('@');
    if (at === -1) return { name: trimmed, versionPart: null };
    return {
      name: trimmed.slice(0, slash + 1 + at),
      versionPart: afterScope.slice(at + 1),
    };
  }

  const at = trimmed.indexOf('@');
  if (at <= 0) return { name: trimmed, versionPart: null };
  return {
    name: trimmed.slice(0, at),
    versionPart: trimmed.slice(at + 1),
  };
}

/**
 * Exact version for allowScripts: digits/dots/prerelease/build only — no
 * range operators and no dist-tags. Multiple exact versions may be joined by `||`.
 */
function isExactVersionToken(token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  // Reject range operators and wildcard (wildcard is its own shape).
  if (/[~^<>*=\s]/.test(t)) return false;
  // Dist-tags are non-numeric labels (latest, next, beta, …).
  if (!/^\d/.test(t)) return false;
  // Loose semver-ish: 1, 1.2, 1.2.3, 1.2.3-beta.1, 1.2.3+build
  return /^\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(t);
}

/**
 * Classify an allowScripts key the way npm's resolve-allow-scripts does:
 * bare name and `name@*` are accepted (but unpinned); exact versions joined
 * by `||` are accepted and pinned; ranges and dist-tags are silently dropped.
 */
export function classifyAllowScriptsKey(key: string): AllowScriptsEntry {
  const { name, versionPart } = splitPackageSpec(key);
  if (!name) {
    return { key, packageName: key, shape: 'invalid' };
  }
  if (versionPart === null) {
    return { key, packageName: name, shape: 'bare' };
  }
  if (versionPart === '*') {
    return { key, packageName: name, shape: 'wildcard' };
  }

  const tokens = versionPart.split('||').map((part) => part.trim());
  if (tokens.length === 0 || tokens.some((token) => !isExactVersionToken(token))) {
    return { key, packageName: name, shape: 'invalid' };
  }
  return { key, packageName: name, shape: 'exact' };
}

function parseAllowScripts(
  packageJson: Record<string, unknown> | null,
): AllowScriptsEntry[] | null {
  if (!packageJson) return null;
  if (!Object.prototype.hasOwnProperty.call(packageJson, 'allowScripts')) return null;
  const raw = packageJson.allowScripts;
  // npm reads an object map; arrays / primitives are not a usable allowlist.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return Object.keys(raw as Record<string, unknown>).map((key) => classifyAllowScriptsKey(key));
}

type DepKind = 'git' | 'remote-tarball' | 'url';

function classifyDependencySpec(spec: string): DepKind | null {
  const s = spec.trim();
  if (!s) return null;

  if (
    /^git\+/i.test(s) ||
    /^git:\/\//i.test(s) ||
    /^(github|gitlab|bitbucket|gist):/i.test(s) ||
    /^ssh:\/\//i.test(s) ||
    /^git@/i.test(s)
  ) {
    return 'git';
  }

  // Direct URL / tarball (may contain credentials — never echo the value).
  if (/^https?:\/\//i.test(s)) {
    if (/\.tgz(\?|#|$)/i.test(s) || /\.tar\.gz(\?|#|$)/i.test(s)) {
      return 'remote-tarball';
    }
    return 'url';
  }

  return null;
}

function isNpmRegistryResolved(resolved: string): boolean {
  try {
    const url = new URL(resolved);
    const host = url.hostname.toLowerCase();
    // Common public / org npm registry hosts. Custom Verdaccio hosts are still
    // "registry" sources (not git / remote tarball under allow-git/allow-remote).
    if (host === 'registry.npmjs.org' || host === 'registry.npmjs.com') return true;
    if (host.endsWith('.npmjs.org') || host.endsWith('.npmjs.com')) return true;
    // GitHub Packages npm registry and similar still go through registry protocol.
    if (host === 'npm.pkg.github.com') return true;
    // Anything that looks like an npm pack URL path on an https host with /-/
    // is treated as registry-shaped; pure tarball hosts without that shape are not.
    if (url.protocol === 'https:' && /\/-\//.test(url.pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

function classifyResolvedUrl(resolved: string): DepKind | null {
  const s = resolved.trim();
  if (!s) return null;
  if (/^git\+/i.test(s) || /^git:\/\//i.test(s) || /^ssh:\/\//i.test(s) || /^git@/i.test(s)) {
    return 'git';
  }
  if (/^https?:\/\//i.test(s)) {
    if (isNpmRegistryResolved(s)) return null;
    if (/\.tgz(\?|#|$)/i.test(s) || /\.tar\.gz(\?|#|$)/i.test(s)) return 'remote-tarball';
    return 'url';
  }
  return null;
}

const DEP_FIELD_KEYS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

function collectManifestDeps(
  packageJson: Record<string, unknown>,
): Array<{ name: string; spec: string }> {
  const out: Array<{ name: string; spec: string }> = [];
  for (const field of DEP_FIELD_KEYS) {
    const node = packageJson[field];
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    for (const [name, spec] of Object.entries(node as Record<string, unknown>)) {
      if (typeof spec === 'string') out.push({ name, spec });
    }
  }
  return out;
}

/**
 * Parse a major version from a Corepack `packageManager` field (`npm@12.0.1`).
 * Returns null when missing, non-npm, or unparseable.
 */
export function parsePackageManagerNpmMajor(
  packageManager: unknown,
): { major: number; raw: string } | null {
  if (typeof packageManager !== 'string') return null;
  const match = /^npm@(\d+)(?:\.\d+)?(?:\.\d+)?(?:[+\-].*)?$/.exec(packageManager.trim());
  if (!match?.[1]) return null;
  const major = Number.parseInt(match[1], 10);
  if (!Number.isFinite(major)) return null;
  return { major, raw: packageManager.trim() };
}

/**
 * True when an `engines.npm` range clearly permits a major below 12.
 * Conservative: ambiguous / missing ranges do not fire (false positives are
 * the failure mode).
 */
export function enginesNpmPermitsBelow12(enginesNpm: unknown): boolean {
  if (typeof enginesNpm !== 'string') return false;
  const range = enginesNpm.trim();
  if (!range) return false;

  if (/\|\|/.test(range)) {
    return range.split('||').some((part) => enginesNpmPermitsBelow12(part.trim()));
  }

  // Exact pin below 12.
  const exact = /^(?:v)?(\d+)(?:\.\d+){0,2}$/i.exec(range);
  if (exact?.[1]) {
    return Number.parseInt(exact[1], 10) < 12;
  }

  // Caret / tilde on major < 12.
  const caret = /^[~^](?:v)?(\d+)/i.exec(range);
  if (caret?.[1] && Number.parseInt(caret[1], 10) < 12) return true;

  // Lower-bound `>=N` that still allows majors 0–11.
  const gte = />=\s*(?:v)?(\d+)/i.exec(range);
  if (gte?.[1] && Number.parseInt(gte[1], 10) < 12) return true;

  // Strict `>N` (not `>=`): strip >= tokens first so we do not misread them.
  const withoutGte = range.replace(/>=\s*(?:v)?\d+(?:\.\d+){0,2}/gi, ' ');
  const gt = />\s*(?:v)?(\d+)/i.exec(withoutGte);
  if (gt?.[1] && Number.parseInt(gt[1], 10) < 11) return true;

  // Upper-bound-only ranges that never reach 12.
  const lteOnly = /^<=\s*(?:v)?(\d+)(?:\.\d+){0,2}$/i.exec(range);
  if (lteOnly?.[1] && Number.parseInt(lteOnly[1], 10) < 12) return true;
  const ltOnly = /^<\s*(?:v)?(\d+)(?:\.\d+){0,2}$/i.exec(range);
  if (ltOnly?.[1] && Number.parseInt(ltOnly[1], 10) <= 12) return true;

  // Hyphen ranges like `10 - 11`
  const hyphen = /^(\d+)(?:\.\d+)*\s*-\s*(\d+)/.exec(range);
  if (hyphen?.[1] && Number.parseInt(hyphen[1], 10) < 12) return true;

  return false;
}

function scanNpmVersionPolicy(
  packageJson: Record<string, unknown>,
  packageJsonContent: string,
): ScannerFinding[] {
  const findings: ScannerFinding[] = [];
  const pm = parsePackageManagerNpmMajor(packageJson.packageManager);
  if (pm && pm.major < 12) {
    findings.push(
      finding(
        SUPPLY_NPM_BELOW_V12,
        'warning',
        'high',
        'package.json',
        lineNumberOfSubstring(packageJsonContent, 'packageManager') ??
          lineNumberOfSubstring(packageJsonContent, pm.raw),
        `packageManager pins ${pm.raw}, so npm 12 install-script defaults (allowScripts, blocked git/remote installs) do not apply.`,
        'Pin npm 12 or newer, e.g. `"packageManager": "npm@12.0.1"`, and reinstall with Corepack.',
      ),
    );
    return findings;
  }

  const engines =
    packageJson.engines &&
    typeof packageJson.engines === 'object' &&
    !Array.isArray(packageJson.engines)
      ? (packageJson.engines as Record<string, unknown>)
      : null;
  const enginesNpm = engines?.npm;
  if (typeof enginesNpm === 'string' && enginesNpmPermitsBelow12(enginesNpm)) {
    findings.push(
      finding(
        SUPPLY_NPM_BELOW_V12,
        'warning',
        'medium',
        'package.json',
        lineNumberOfSubstring(packageJsonContent, 'engines') ??
          lineNumberOfSubstring(packageJsonContent, enginesNpm),
        `engines.npm "${enginesNpm}" permits npm below 12, so install-script allowlisting and related defaults may not apply.`,
        'Require npm 12+, e.g. `"engines": { "npm": ">=12" }`, or pin `"packageManager": "npm@12.0.1"`.',
      ),
    );
  }

  return findings;
}

function scanAllowScriptsEntries(
  entries: AllowScriptsEntry[],
  packageJsonContent: string,
  lockNames: Set<string> | null,
): ScannerFinding[] {
  const findings: ScannerFinding[] = [];

  for (const entry of entries) {
    if (entry.shape === 'invalid') {
      findings.push(
        finding(
          SUPPLY_ALLOWSCRIPTS_INVALID,
          'warning',
          'high',
          'package.json',
          lineNumberOfSubstring(packageJsonContent, entry.key),
          `allowScripts key "${entry.key}" uses a range or dist-tag that npm silently drops, so it does not grant the permission you think it does.`,
          'Use a bare name, `name@*`, or exact versions joined by `||` (e.g. `"pkg@1.0.0||2.0.0": true`). Ranges (^/~/>=/<) and dist-tags (latest/next) are rejected.',
        ),
      );
      continue;
    }

    if (entry.shape === 'bare' || entry.shape === 'wildcard') {
      findings.push(
        finding(
          SUPPLY_ALLOWSCRIPTS_UNPINNED,
          'warning',
          'high',
          'package.json',
          lineNumberOfSubstring(packageJsonContent, entry.key),
          `allowScripts entry "${entry.key}" grants install-script execution to every version of ${entry.packageName}, including future publishes.`,
          `Pin an exact version (e.g. "${entry.packageName}@<version>": true). Bare names and "name@*" approve every future release.`,
        ),
      );
    }

    if (lockNames && !lockNames.has(entry.packageName)) {
      findings.push(
        finding(
          SUPPLY_ALLOWSCRIPTS_STALE,
          'warning',
          'high',
          'package.json',
          lineNumberOfSubstring(packageJsonContent, entry.key),
          `allowScripts lists "${entry.packageName}", but that package is not in the lockfile. A stale allowlist entry is not merely untidy — if the name is re-added later (by an agent, or by someone registering an abandoned name; see dep-slopsquat-suspect), it installs with script execution already approved.`,
          'Remove stale keys with `npm install-scripts prune`, or delete the entry by hand. Only allowlist packages you currently depend on, pinned to exact versions.',
        ),
      );
    }
  }

  return findings;
}

function scanNonRegistryDeps(
  packageJson: Record<string, unknown>,
  packageJsonContent: string,
  lock: ParsedLockfile | null,
): ScannerFinding[] {
  const findings: ScannerFinding[] = [];
  const seen = new Set<string>();

  for (const dep of collectManifestDeps(packageJson)) {
    const kind = classifyDependencySpec(dep.spec);
    if (!kind) continue;
    const dedupe = `manifest:${dep.name}:${kind}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    findings.push(
      finding(
        SUPPLY_NON_REGISTRY_DEPENDENCY,
        'warning',
        'high',
        'package.json',
        lineNumberOfSubstring(packageJsonContent, dep.name),
        `Dependency "${dep.name}" is declared from a non-registry source (${kind}). npm 12 blocks git and remote tarball installs by default unless allow-git / allow-remote is set.`,
        'Prefer a registry package with a pinned version. If the non-registry source is intentional, document why and set the matching npm allow flag deliberately — not because an agent needed the install to succeed.',
      ),
    );
  }

  if (lock) {
    for (const pkg of lock.packages) {
      if (!pkg.resolved) continue;
      const kind = classifyResolvedUrl(pkg.resolved);
      if (!kind) continue;
      const dedupe = `lock:${pkg.name}:${kind}`;
      if (seen.has(dedupe)) continue;
      // Skip if already flagged from the manifest for the same name.
      if (seen.has(`manifest:${pkg.name}:${kind}`)) continue;
      seen.add(dedupe);
      findings.push(
        finding(
          SUPPLY_NON_REGISTRY_DEPENDENCY,
          'warning',
          'high',
          'package-lock.json',
          undefined,
          `Lockfile entry "${pkg.name}" resolves from a non-registry source (${kind}). npm 12 blocks git and remote tarball installs by default unless allow-git / allow-remote is set.`,
          'Prefer a registry package with a pinned version. Review who added this resolved URL and whether install should be allowed deliberately.',
        ),
      );
    }
  }

  return findings;
}

function scanWorkspaceAllowScripts(
  workspacePackageJsons: readonly WorkspacePackageJsonInput[] | undefined,
): ScannerFinding[] {
  if (!workspacePackageJsons || workspacePackageJsons.length === 0) return [];
  const findings: ScannerFinding[] = [];

  for (const workspace of workspacePackageJsons) {
    const normalized = workspace.file.replace(/\\/g, '/');
    // Root package.json is never a workspace member input.
    if (normalized === 'package.json') continue;

    const parsed = parseJsonObject(workspace.content);
    if (!parsed) continue;
    if (!Object.prototype.hasOwnProperty.call(parsed, 'allowScripts')) continue;
    const raw = parsed.allowScripts;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;

    findings.push(
      finding(
        SUPPLY_ALLOWSCRIPTS_IN_WORKSPACE,
        'warning',
        'high',
        normalized,
        lineNumberOfSubstring(workspace.content, 'allowScripts'),
        `Workspace package declares allowScripts, but npm only reads allowScripts from the workspace root — this entry is ignored.`,
        'Move the allowScripts map into the root package.json (exact version pins), then remove it from this workspace package.',
      ),
    );
  }

  return findings;
}

/**
 * Scan local install-time trust artefacts. Never throws on malformed input.
 */
export function scanSupplyChain(input: SupplyChainScanInput): SupplyChainScanResult {
  const findings: ScannerFinding[] = [];

  const packageJsonContent = input.packageJson ?? null;
  const packageJson = parseJsonObject(packageJsonContent);
  const lock = parseLockfile(input.packageLock);
  const ignoreScripts = readIgnoreScriptsFromNpmrc(input.npmrc);
  const allowScripts = parseAllowScripts(packageJson);

  // --- supply-install-scripts-unreviewed ------------------------------------
  if (lock && ignoreScripts !== true) {
    // Count lockfile entries with hasInstallScript (including nested copies).
    // Nested installs are separate install-script surfaces in the lockfile.
    const withScripts = lock.packages.filter((pkg) => pkg.hasInstallScript);
    if (withScripts.length > 0 && allowScripts === null) {
      findings.push(
        finding(
          SUPPLY_INSTALL_SCRIPTS_UNREVIEWED,
          'warning',
          'high',
          'package-lock.json',
          undefined,
          `${withScripts.length} package${withScripts.length === 1 ? '' : 's'} can run code at install time (hasInstallScript in the lockfile), but package.json has no allowScripts and .npmrc does not set ignore-scripts=true. npm 12 blocks install scripts by default — without an allowlist you have not recorded which ones you trust.`,
          'List unreviewed packages with `npm install-scripts --allow-scripts-pending`, then add exact version pins to root package.json allowScripts (or set ignore-scripts=true if you intend to run none). Assurly checks this on every scan so the allowlist does not depend on someone remembering to run that command.',
        ),
      );
    }
  }

  // --- allowScripts shapes / stale ------------------------------------------
  if (packageJson && packageJsonContent && allowScripts) {
    findings.push(
      ...scanAllowScriptsEntries(allowScripts, packageJsonContent, lock?.packageNames ?? null),
    );
  }

  // --- workspace allowScripts -----------------------------------------------
  findings.push(...scanWorkspaceAllowScripts(input.workspacePackageJsons));

  // --- non-registry deps ----------------------------------------------------
  if (packageJson && packageJsonContent) {
    findings.push(...scanNonRegistryDeps(packageJson, packageJsonContent, lock));
  }

  // --- npm below v12 --------------------------------------------------------
  if (packageJson && packageJsonContent) {
    findings.push(...scanNpmVersionPolicy(packageJson, packageJsonContent));
  }

  return result(findings);
}
