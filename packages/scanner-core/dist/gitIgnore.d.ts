export interface GitIgnoreFileInput {
    file: string;
    content: string;
}
/** Directory containing a `.gitignore` (`''` for repo root) plus its patterns. */
export interface GitIgnoreSource {
    dir: string;
    content: string;
}
/** True when `filePath` is a `.gitignore` at any directory depth. */
export declare function isGitIgnorePath(filePath: string): boolean;
/**
 * Assurly env-docs surface (`envRules` / `scanWorkspaceFiles` `allExamples`).
 * Browser gitignore has no git index, so create-next-app `.env*` would otherwise
 * hide a committed `.env.example` that CLI still scans as a tracked file.
 * `.env` / `.env.local` stay ignorable.
 */
export declare function isAssurlyEnvExamplePath(filePath: string): boolean;
/**
 * Collect nested `.gitignore` files, root first so closer rules can un-ignore.
 */
export declare function parseGitIgnoreSources(files: readonly GitIgnoreFileInput[]): GitIgnoreSource[];
/**
 * Gitignore match for a path relative to the project root (after folder-prefix strip).
 * `.gitignore` files and Assurly `.env.example` docs are never treated as ignored.
 */
export declare function isGitIgnored(relativePath: string, sources: readonly GitIgnoreSource[]): boolean;
/**
 * Drop gitignored inputs. Missing `.gitignore` → identity. `.gitignore` files stay.
 */
export declare function excludeGitIgnoredFiles<T extends GitIgnoreFileInput>(files: readonly T[]): T[];
