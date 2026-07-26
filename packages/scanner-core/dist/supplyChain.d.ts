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
import type { ScannerFinding } from './index';
export declare const SUPPLY_INSTALL_SCRIPTS_UNREVIEWED = "supply-install-scripts-unreviewed";
export declare const SUPPLY_ALLOWSCRIPTS_UNPINNED = "supply-allowscripts-unpinned";
export declare const SUPPLY_ALLOWSCRIPTS_STALE = "supply-allowscripts-stale";
export declare const SUPPLY_ALLOWSCRIPTS_INVALID = "supply-allowscripts-invalid";
export declare const SUPPLY_ALLOWSCRIPTS_IN_WORKSPACE = "supply-allowscripts-in-workspace";
export declare const SUPPLY_NON_REGISTRY_DEPENDENCY = "supply-non-registry-dependency";
export declare const SUPPLY_NPM_BELOW_V12 = "supply-npm-below-v12";
/** All `supply-*` rule ids emitted by this module. */
export declare const SUPPLY_CHAIN_RULE_IDS: readonly ["supply-install-scripts-unreviewed", "supply-allowscripts-unpinned", "supply-allowscripts-stale", "supply-allowscripts-invalid", "supply-allowscripts-in-workspace", "supply-non-registry-dependency", "supply-npm-below-v12"];
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
/** True when `ruleId` is a supply-chain install-time trust rule. */
export declare function isSupplyChainRuleId(ruleId: string | undefined): boolean;
/**
 * Reads `ignore-scripts` from project-root `.npmrc` only.
 * Never returns or echoes any other setting value (auth tokens live here).
 */
export declare function readIgnoreScriptsFromNpmrc(npmrc: string | null | undefined): boolean | undefined;
/**
 * Extract the package name from a lockfile `packages` key
 * (`node_modules/foo`, `node_modules/@scope/pkg`, nested copies).
 */
export declare function packageNameFromLockKey(key: string): string | null;
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
export declare function splitPackageSpec(spec: string): {
    name: string;
    versionPart: string | null;
};
/**
 * Classify an allowScripts key the way npm's resolve-allow-scripts does:
 * bare name and `name@*` are accepted (but unpinned); exact versions joined
 * by `||` are accepted and pinned; ranges and dist-tags are silently dropped.
 */
export declare function classifyAllowScriptsKey(key: string): AllowScriptsEntry;
/**
 * Parse a major version from a Corepack `packageManager` field (`npm@12.0.1`).
 * Returns null when missing, non-npm, or unparseable.
 */
export declare function parsePackageManagerNpmMajor(packageManager: unknown): {
    major: number;
    raw: string;
} | null;
/**
 * True when an `engines.npm` range clearly permits a major below 12.
 * Conservative: ambiguous / missing ranges do not fire (false positives are
 * the failure mode).
 */
export declare function enginesNpmPermitsBelow12(enginesNpm: unknown): boolean;
/**
 * Scan local install-time trust artefacts. Never throws on malformed input.
 */
export declare function scanSupplyChain(input: SupplyChainScanInput): SupplyChainScanResult;
export {};
