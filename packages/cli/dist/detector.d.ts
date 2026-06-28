import { TechStack, ProjectContext } from './types';
/**
 * Recursively scans a directory to list all file paths, ignoring common system/dependency folders.
 */
export declare function listFiles(dir: string, baseDir?: string): string[];
/**
 * Detects the technologies used in the project by reading package.json and file structure.
 */
export declare function detectStack(projectPath: string): TechStack;
/**
 * Builds the project context by scanning the target directory.
 */
export declare function buildContext(projectPath: string): ProjectContext;
