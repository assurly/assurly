"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGitIgnorePath = isGitIgnorePath;
exports.isAssurlyEnvExamplePath = isAssurlyEnvExamplePath;
exports.parseGitIgnoreSources = parseGitIgnoreSources;
exports.isGitIgnored = isGitIgnored;
exports.excludeGitIgnoredFiles = excludeGitIgnoredFiles;
const ignore_1 = __importDefault(require("ignore"));
function posixPath(filePath) {
    return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}
/** True when `filePath` is a `.gitignore` at any directory depth. */
function isGitIgnorePath(filePath) {
    return /(^|\/)\.gitignore$/.test(posixPath(filePath));
}
/**
 * Assurly env-docs surface (`envRules` / `scanWorkspaceFiles` `allExamples`).
 * Browser gitignore has no git index, so create-next-app `.env*` would otherwise
 * hide a committed `.env.example` that CLI still scans as a tracked file.
 * `.env` / `.env.local` stay ignorable.
 */
function isAssurlyEnvExamplePath(filePath) {
    return /(?:^|\/)\.env\.example$/i.test(posixPath(filePath));
}
/**
 * Collect nested `.gitignore` files, root first so closer rules can un-ignore.
 */
function parseGitIgnoreSources(files) {
    return files
        .filter((file) => isGitIgnorePath(file.file))
        .map((file) => {
        const normalized = posixPath(file.file);
        const slash = normalized.lastIndexOf('/');
        return {
            dir: slash === -1 ? '' : normalized.slice(0, slash),
            content: file.content,
        };
    })
        .sort((left, right) => left.dir.length - right.dir.length || left.dir.localeCompare(right.dir));
}
/**
 * Gitignore match for a path relative to the project root (after folder-prefix strip).
 * `.gitignore` files and Assurly `.env.example` docs are never treated as ignored.
 */
function isGitIgnored(relativePath, sources) {
    const posix = posixPath(relativePath);
    if (!posix || isGitIgnorePath(posix) || isAssurlyEnvExamplePath(posix))
        return false;
    let ignored = false;
    for (const source of sources) {
        if (source.dir && posix !== source.dir && !posix.startsWith(`${source.dir}/`)) {
            continue;
        }
        const relative = source.dir ? posix.slice(source.dir.length + 1) : posix;
        if (!relative)
            continue;
        const result = (0, ignore_1.default)().add(source.content).test(relative);
        if (result.unignored)
            ignored = false;
        else if (result.ignored)
            ignored = true;
    }
    return ignored;
}
/**
 * Drop gitignored inputs. Missing `.gitignore` → identity. `.gitignore` files stay.
 */
function excludeGitIgnoredFiles(files) {
    const sources = parseGitIgnoreSources(files);
    if (sources.length === 0)
        return [...files];
    return files.filter((file) => !isGitIgnored(file.file, sources));
}
