import type { ScannerFinding } from './index';
/**
 * Server-side / application languages the engine cannot parse. Config, docs,
 * and lockfiles stay off this list — they are not a silent backend.
 */
export declare const UNANALYZED_SOURCE_LANGUAGES: Readonly<Record<string, string>>;
export declare const SCAN_LANGUAGE_COVERAGE_RULE_ID = "scan-language-coverage";
export interface UnanalyzedLanguageSummary {
    language: string;
    fileCount: number;
    securitySurfaceExamples: string[];
}
export interface UnanalyzedSourceSummary {
    languages: UnanalyzedLanguageSummary[];
    totalFiles: number;
}
export interface UnanalyzedLanguageCount {
    language: string;
    fileCount: number;
}
/** JS/TS/SQL the engine parses. Env files are config, not source. */
export declare function isAnalyzedCodeFile(filePath: string): boolean;
export declare function isAnalyzedSourceFile(filePath: string): boolean;
export declare function unanalyzedLanguageForPath(filePath: string): string | null;
export declare function isSecuritySurfacePath(filePath: string): boolean;
export declare function summarizeUnanalyzedSource(paths: readonly string[]): UnanalyzedSourceSummary;
export declare function unanalyzedLanguageCounts(summary: UnanalyzedSourceSummary): UnanalyzedLanguageCount[] | undefined;
/**
 * Warning only when the unread files include payment/auth surface. A Go CLI
 * helper with no security-relevant paths stays a scope-line note.
 */
export declare function unanalyzedSourceFinding(summary: UnanalyzedSourceSummary): ScannerFinding | null;
export declare function formatUnanalyzedLogLine(summary: UnanalyzedSourceSummary): string | null;
