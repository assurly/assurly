"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PACKAGE_MANIFESTS = void 0;
exports.selectPackageManifestPaths = selectPackageManifestPaths;
exports.detectStackFromManifests = detectStackFromManifests;
exports.describeDetectedStack = describeDetectedStack;
/** Cap nested-manifest fetches in the browser Instant Gate. */
exports.MAX_PACKAGE_MANIFESTS = 8;
const EMPTY_STACK = {
    framework: 'unknown',
    database: 'none',
    payments: 'none',
    deployment: 'unknown',
};
function normalizePath(filePath) {
    return filePath.replace(/\\/g, '/');
}
function isNodeModulesPath(filePath) {
    const normalized = normalizePath(filePath);
    return normalized.includes('/node_modules/') || normalized.startsWith('node_modules/');
}
function isPackageJsonPath(filePath) {
    const normalized = normalizePath(filePath);
    return normalized === 'package.json' || normalized.endsWith('/package.json');
}
function depthOf(filePath) {
    return normalizePath(filePath).split('/').length;
}
/**
 * Nested workspace manifests, shallowest first, excluding `node_modules`.
 */
function selectPackageManifestPaths(filePaths, limit = exports.MAX_PACKAGE_MANIFESTS) {
    return filePaths
        .filter((filePath) => isPackageJsonPath(filePath) && !isNodeModulesPath(filePath))
        .sort((left, right) => depthOf(left) - depthOf(right) || normalizePath(left).localeCompare(normalizePath(right)))
        .slice(0, limit);
}
function siblingVercelJson(manifestPath) {
    const normalized = normalizePath(manifestPath);
    const slash = normalized.lastIndexOf('/');
    if (slash === -1)
        return 'vercel.json';
    return `${normalized.slice(0, slash)}/vercel.json`;
}
function parseDependencyNames(content) {
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return null;
    const record = parsed;
    const names = {};
    for (const bag of [record.dependencies, record.devDependencies]) {
        if (!bag || typeof bag !== 'object' || Array.isArray(bag))
            continue;
        for (const [name, version] of Object.entries(bag)) {
            names[name] = typeof version === 'string' ? version : '';
        }
    }
    return names;
}
/**
 * Merge every workspace `package.json` the same way the CLI detector does.
 * A root-only read reports unknown/none on monorepos whose deps live in `web/`
 * or `apps/web/`.
 */
function detectStackFromManifests(input) {
    const stack = { ...EMPTY_STACK };
    const filePaths = (input.filePaths ?? []).map(normalizePath);
    const filePathSet = new Set(filePaths);
    const allDeps = {};
    let sawVercelConfig = filePathSet.has('vercel.json');
    for (const manifest of input.manifests) {
        if (isNodeModulesPath(manifest.path))
            continue;
        const deps = parseDependencyNames(manifest.content);
        if (!deps)
            continue;
        Object.assign(allDeps, deps);
        if (filePathSet.has(siblingVercelJson(manifest.path))) {
            sawVercelConfig = true;
        }
    }
    if (allDeps['next']) {
        stack.framework = 'nextjs';
    }
    if (allDeps['@supabase/supabase-js'] || allDeps['@supabase/ssr']) {
        stack.database = 'supabase';
    }
    else if (allDeps['prisma'] || allDeps['@prisma/client']) {
        stack.database = 'prisma';
    }
    if (allDeps['stripe'] || allDeps['@stripe/stripe-js']) {
        stack.payments = 'stripe';
    }
    if (sawVercelConfig || allDeps['@vercel/analytics']) {
        stack.deployment = 'vercel';
    }
    else if (stack.framework === 'nextjs') {
        stack.deployment = 'vercel';
    }
    return stack;
}
function describeDetectedStack(stack) {
    let framework;
    switch (stack.framework) {
        case 'nextjs':
            framework = 'Next.js';
            break;
        case 'unknown':
            framework = 'Unknown';
            break;
        default: {
            const exhaustive = stack.framework;
            framework = exhaustive;
            break;
        }
    }
    return {
        framework,
        supabase: stack.database === 'supabase' ? 'Detected' : 'Not Detected',
        stripe: stack.payments === 'stripe' ? 'Detected' : 'Not Detected',
    };
}
