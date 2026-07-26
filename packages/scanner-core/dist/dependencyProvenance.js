"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEP_DEFAULT_EVAL_CAP = exports.DEP_PROXIMITY_MAX_DISTANCE = exports.DEP_LOW_DOWNLOADS = exports.DEP_YOUNG_AGE_DAYS = exports.DEP_SCAN_CAPPED = exports.DEP_REGISTRY_UNAVAILABLE = exports.DEP_NEW_UNVETTED = exports.DEP_SLOPSQUAT_SUSPECT = exports.DEP_TYPOSQUAT_SUSPECT = exports.DEP_NONEXISTENT_PACKAGE = void 0;
exports.tokenizePackageName = tokenizePackageName;
exports.contiguousTokenRuns = contiguousTokenRuns;
exports.scopeOwnsBorrowedName = scopeOwnsBorrowedName;
exports.findBorrowedCorpusName = findBorrowedCorpusName;
exports.isAbandonedShape = isAbandonedShape;
exports.evaluateDependencyProvenance = evaluateDependencyProvenance;
exports.evaluateNewDependencies = evaluateNewDependencies;
exports.collectDependencyNames = collectDependencyNames;
exports.diffAddedDependencies = diffAddedDependencies;
exports.parsePackageJsonDependencies = parsePackageJsonDependencies;
exports.getTopNpmPackageCorpus = getTopNpmPackageCorpus;
const editDistance_1 = require("./editDistance");
const topNpmPackages_1 = require("./data/topNpmPackages");
exports.DEP_NONEXISTENT_PACKAGE = 'dep-nonexistent-package';
/** Edit-distance lookalike (was mislabelled dep-slopsquat-suspect). */
exports.DEP_TYPOSQUAT_SUSPECT = 'dep-typosquat-suspect';
/** Borrowed name + abandoned registry shape + low downloads. */
exports.DEP_SLOPSQUAT_SUSPECT = 'dep-slopsquat-suspect';
exports.DEP_NEW_UNVETTED = 'dep-new-unvetted';
exports.DEP_REGISTRY_UNAVAILABLE = 'dep-registry-unavailable';
exports.DEP_SCAN_CAPPED = 'dep-scan-capped';
/** Age threshold for "young" packages (days) — typosquat + new-unvetted only. */
exports.DEP_YOUNG_AGE_DAYS = 30;
/** Weekly download floor below which adoption is "low". */
exports.DEP_LOW_DOWNLOADS = 100;
/** Max Damerau-Levenshtein distance for typosquat proximity. */
exports.DEP_PROXIMITY_MAX_DISTANCE = 2;
/** Default cap on new dependencies evaluated per PR. */
exports.DEP_DEFAULT_EVAL_CAP = 40;
const result = (findings) => ({
    errorCount: findings.filter((finding) => finding.severity === 'error').length,
    warningCount: findings.filter((finding) => finding.severity === 'warning').length,
    findings,
});
function finding(ruleId, severity, confidence, file, message, suggestion) {
    return { ruleId, severity, confidence, file, line: 1, message, suggestion };
}
function resolveNearestMatch(packageName, nearestMatch, corpus) {
    if (nearestMatch !== undefined)
        return nearestMatch;
    return (0, editDistance_1.findNearestCorpusMatch)(packageName, corpus, exports.DEP_PROXIMITY_MAX_DISTANCE);
}
/**
 * Splits an unscoped package name into tokens on `-`, `_`, and `.`.
 * Empty tokens are dropped.
 */
function tokenizePackageName(unscopedName) {
    return unscopedName
        .toLowerCase()
        .split(/[-_.]+/)
        .filter((token) => token.length > 0);
}
/**
 * Contiguous token runs of length ≥ 1, joined with `-` (npm's dominant
 * separator). Longer runs are preferred by the caller when matching.
 */
function contiguousTokenRuns(tokens) {
    const runs = [];
    for (let start = 0; start < tokens.length; start += 1) {
        for (let end = start + 1; end <= tokens.length; end += 1) {
            runs.push(tokens.slice(start, end).join('-'));
        }
    }
    // Prefer longer runs first so `next-auth` wins over `next` alone.
    return runs.sort((a, b) => b.length - a.length || a.localeCompare(b));
}
function parseScopedName(packageName) {
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
function scopeOwnsBorrowedName(scope, borrowed) {
    if (!scope)
        return false;
    const scopeBody = scope.startsWith('@') ? scope.slice(1) : scope;
    return scopeBody === borrowed.toLowerCase();
}
/**
 * Finds a borrowed corpus name inside `packageName` via exact token or
 * contiguous-run match. Returns null when the full name is itself a corpus
 * entry, or when the only borrows are owned by the package's own scope.
 */
function findBorrowedCorpusName(packageName, corpusSet = topNpmPackages_1.TOP_NPM_PACKAGE_NAME_SET) {
    const { scope, name } = parseScopedName(packageName);
    const fullName = scope ? `${scope}/${name}` : name;
    if (!name)
        return null;
    if (corpusSet.has(fullName) || corpusSet.has(name))
        return null;
    const tokens = tokenizePackageName(name);
    if (tokens.length === 0)
        return null;
    for (const run of contiguousTokenRuns(tokens)) {
        if (!corpusSet.has(run))
            continue;
        if (scopeOwnsBorrowedName(scope, run))
            continue;
        return { name: run };
    }
    return null;
}
function resolveBorrowedName(packageName, borrowedName, corpusSet) {
    if (borrowedName !== undefined)
        return borrowedName;
    return findBorrowedCorpusName(packageName, corpusSet)?.name ?? null;
}
/** Abandoned shape: exactly one published version and no repository field. */
function isAbandonedShape(versionCount, hasRepository) {
    return versionCount === 1 && hasRepository === false;
}
/**
 * Evaluates one newly added dependency against registry signals.
 * Returns zero or one finding — never invents a signal that wasn't supplied.
 */
function evaluateDependencyProvenance(signals, options = {}) {
    const file = signals.file ?? 'package.json';
    const name = signals.packageName.trim();
    if (!name)
        return null;
    if (signals.exists === null) {
        return finding(exports.DEP_REGISTRY_UNAVAILABLE, 'warning', 'medium', file, `Could not verify npm registry metadata for '${name}' (lookup failed or timed out).`, 'Retry the check later, or confirm the package exists at registry.npmjs.org before merging.');
    }
    if (signals.exists === false) {
        return finding(exports.DEP_NONEXISTENT_PACKAGE, 'error', 'high', file, `Newly added dependency '${name}' does not exist on the npm registry — it has never been published.`, `Remove '${name}' or replace it with a real package. AI models sometimes hallucinate plausible package names.`);
    }
    const corpus = options.corpus ?? topNpmPackages_1.TOP_NPM_PACKAGE_NAMES;
    const corpusSet = options.corpus !== undefined
        ? new Set(options.corpus.map((entry) => entry.toLowerCase()))
        : topNpmPackages_1.TOP_NPM_PACKAGE_NAME_SET;
    const ageDays = signals.ageDays;
    const downloads = signals.weeklyDownloads;
    const young = ageDays !== null && ageDays < exports.DEP_YOUNG_AGE_DAYS;
    const lowDownloads = downloads !== null && downloads < exports.DEP_LOW_DOWNLOADS;
    // --- Typosquat (edit distance): keep prior logic, renamed --------------------
    if (young && lowDownloads) {
        const nearest = resolveNearestMatch(name, signals.nearestMatch, corpus);
        if (nearest && nearest.distance <= exports.DEP_PROXIMITY_MAX_DISTANCE) {
            return finding(exports.DEP_TYPOSQUAT_SUSPECT, 'error', 'high', file, `Newly added dependency '${name}' looks like a typosquat: published ${ageDays} day(s) ago, only ${downloads} download(s) last week, and within edit distance ${nearest.distance} of popular package '${nearest.name}'.`, `Verify '${name}' is the intended package. If you meant '${nearest.name}', fix the name. Do not install an unfamiliar package that closely matches a popular one.`);
        }
    }
    // --- Slopsquat (borrowed name + abandoned shape + low downloads) ------------
    // Age is deliberately NOT a factor — pre-registered squats wait out any window.
    const borrowed = resolveBorrowedName(name, signals.borrowedName, corpusSet);
    if (borrowed) {
        const abandoned = isAbandonedShape(signals.versionCount, signals.hasRepository);
        const extras = [abandoned, lowDownloads].filter(Boolean).length;
        if (abandoned && lowDownloads) {
            return finding(exports.DEP_SLOPSQUAT_SUSPECT, 'error', 'high', file, `Newly added dependency '${name}' looks like a slopsquat: it borrows the popular name '${borrowed}', has only one published version with no repository, and only ${downloads} download(s) last week.`, `Verify '${name}' is the package you intended. AI models often invent plausible names that attackers (or defensive placeholders) pre-register. Prefer the real package behind '${borrowed}'.`);
        }
        if (extras === 1) {
            const reason = abandoned
                ? 'has only one published version with no repository'
                : `has only ${downloads} download(s) last week`;
            return finding(exports.DEP_SLOPSQUAT_SUSPECT, 'warning', 'medium', file, `Newly added dependency '${name}' borrows the popular name '${borrowed}' and ${reason}.`, `Confirm the publisher and source before merging. Borrowed names with thin provenance deserve a second look.`);
        }
        // borrowed only → no finding (ecosystem naming conventions are full of this)
    }
    // --- Young + low, no typosquat / slopsquat hit ------------------------------
    if (young && lowDownloads) {
        return finding(exports.DEP_NEW_UNVETTED, 'warning', 'medium', file, `Newly added dependency '${name}' is young (${ageDays} day(s) old) with only ${downloads} download(s) last week.`, 'Confirm the package publisher and source before merging. New packages with little adoption deserve a second look.');
    }
    return null;
}
/**
 * Evaluates a list of newly added dependencies. Caps evaluation count; when
 * more packages are added than the cap, emits a single warning naming the
 * overflow count and still evaluates the first `cap` entries.
 */
function evaluateNewDependencies(signalsList, options = {}) {
    const cap = options.cap ?? exports.DEP_DEFAULT_EVAL_CAP;
    const findings = [];
    if (signalsList.length > cap) {
        findings.push(finding(exports.DEP_SCAN_CAPPED, 'warning', 'medium', signalsList[0]?.file ?? 'package.json', `This PR adds ${signalsList.length} new dependencies; only the first ${cap} were provenance-checked.`, 'Split large dependency upgrades into smaller PRs, or review the remaining packages manually.'));
    }
    for (const signals of signalsList.slice(0, cap)) {
        const evaluated = evaluateDependencyProvenance(signals, {
            corpus: options.corpus,
        });
        if (evaluated)
            findings.push(evaluated);
    }
    return result(findings);
}
/** Merges production + dev dependency names from a package.json shape. */
function collectDependencyNames(manifest) {
    const names = new Set();
    for (const section of [
        manifest.dependencies,
        manifest.devDependencies,
        manifest.optionalDependencies,
    ]) {
        if (!section || typeof section !== 'object')
            continue;
        for (const key of Object.keys(section)) {
            if (key.trim())
                names.add(key.trim());
        }
    }
    return names;
}
/**
 * Returns package names present in `head` but absent from `base`.
 * Peer dependencies are ignored — they are not installed by the consumer.
 */
function diffAddedDependencies(baseManifest, headManifest) {
    const baseNames = baseManifest ? collectDependencyNames(baseManifest) : new Set();
    const headNames = collectDependencyNames(headManifest);
    const added = [];
    for (const depName of headNames) {
        if (!baseNames.has(depName))
            added.push(depName);
    }
    return added.sort((a, b) => a.localeCompare(b));
}
/**
 * Parses package.json text into a dependency shape. Returns null on malformed
 * JSON or a non-object root — callers treat that as "no manifest".
 */
function parsePackageJsonDependencies(content) {
    try {
        const parsed = JSON.parse(content);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
/** Bundled corpus accessor for callers that need proximity without importing data. */
function getTopNpmPackageCorpus() {
    return topNpmPackages_1.TOP_NPM_PACKAGE_NAMES;
}
