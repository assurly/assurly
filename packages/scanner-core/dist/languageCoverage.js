"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCAN_LANGUAGE_COVERAGE_RULE_ID = exports.UNANALYZED_SOURCE_LANGUAGES = void 0;
exports.isAnalyzedCodeFile = isAnalyzedCodeFile;
exports.isAnalyzedSourceFile = isAnalyzedSourceFile;
exports.unanalyzedLanguageForPath = unanalyzedLanguageForPath;
exports.isSecuritySurfacePath = isSecuritySurfacePath;
exports.summarizeUnanalyzedSource = summarizeUnanalyzedSource;
exports.unanalyzedLanguageCounts = unanalyzedLanguageCounts;
exports.unanalyzedSourceFinding = unanalyzedSourceFinding;
exports.formatUnanalyzedLogLine = formatUnanalyzedLogLine;
function normalizePath(filePath) {
    return filePath.replace(/\\/g, '/');
}
function extensionOf(filePath) {
    const normalized = normalizePath(filePath);
    const base = normalized.split('/').pop() ?? normalized;
    const dot = base.lastIndexOf('.');
    if (dot <= 0)
        return '';
    return base.slice(dot).toLowerCase();
}
/** Files whose contents the ship-gate rules actually parse. */
const ANALYZED_SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.sql']);
/**
 * Server-side / application languages the engine cannot parse. Config, docs,
 * and lockfiles stay off this list — they are not a silent backend.
 */
exports.UNANALYZED_SOURCE_LANGUAGES = {
    '.go': 'Go',
    '.py': 'Python',
    '.rb': 'Ruby',
    '.php': 'PHP',
    '.java': 'Java',
    '.kt': 'Kotlin',
    '.rs': 'Rust',
    '.cs': 'C#',
    '.ex': 'Elixir',
    '.exs': 'Elixir',
    '.swift': 'Swift',
    '.dart': 'Dart',
};
const SECURITY_SURFACE_PATH = /(stripe|billing|checkout|payment|webhook|auth|session|token|middleware|handler|repositor|admin)/i;
const MAX_SECURITY_SURFACE_EXAMPLES = 2;
exports.SCAN_LANGUAGE_COVERAGE_RULE_ID = 'scan-language-coverage';
/** JS/TS/SQL the engine parses. Env files are config, not source. */
function isAnalyzedCodeFile(filePath) {
    return ANALYZED_SOURCE_EXTENSIONS.has(extensionOf(filePath));
}
function isAnalyzedSourceFile(filePath) {
    const normalized = normalizePath(filePath);
    const base = normalized.split('/').pop() ?? normalized;
    if (base === '.env' || base.startsWith('.env.'))
        return true;
    return isAnalyzedCodeFile(normalized);
}
function unanalyzedLanguageForPath(filePath) {
    if (isAnalyzedSourceFile(filePath))
        return null;
    return exports.UNANALYZED_SOURCE_LANGUAGES[extensionOf(filePath)] ?? null;
}
function isSecuritySurfacePath(filePath) {
    return SECURITY_SURFACE_PATH.test(normalizePath(filePath));
}
function summarizeUnanalyzedSource(paths) {
    const byLanguage = new Map();
    for (const filePath of paths) {
        const language = unanalyzedLanguageForPath(filePath);
        if (!language)
            continue;
        const entry = byLanguage.get(language) ?? { fileCount: 0, securitySurfaceExamples: [] };
        entry.fileCount += 1;
        if (isSecuritySurfacePath(filePath) &&
            entry.securitySurfaceExamples.length < MAX_SECURITY_SURFACE_EXAMPLES) {
            entry.securitySurfaceExamples.push(normalizePath(filePath));
        }
        byLanguage.set(language, entry);
    }
    const languages = [...byLanguage.entries()]
        .map(([language, entry]) => ({ language, ...entry }))
        .sort((left, right) => right.fileCount - left.fileCount || left.language.localeCompare(right.language));
    return {
        languages,
        totalFiles: languages.reduce((sum, item) => sum + item.fileCount, 0),
    };
}
function unanalyzedLanguageCounts(summary) {
    if (summary.languages.length === 0)
        return undefined;
    return summary.languages.map(({ language, fileCount }) => ({ language, fileCount }));
}
function formatLanguageCounts(languages) {
    const parts = languages.map((item) => {
        const noun = item.fileCount === 1 ? 'file' : 'files';
        return `${item.fileCount} ${item.language} ${noun}`;
    });
    if (parts.length === 1)
        return parts[0];
    if (parts.length === 2)
        return `${parts[0]} and ${parts[1]}`;
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
function verbForCount(totalFiles) {
    return totalFiles === 1 ? 'was' : 'were';
}
/**
 * Warning only when the unread files include payment/auth surface. A Go CLI
 * helper with no security-relevant paths stays a scope-line note.
 */
function unanalyzedSourceFinding(summary) {
    const withSurface = summary.languages.filter((language) => language.securitySurfaceExamples.length > 0);
    if (withSurface.length === 0)
        return null;
    const examples = withSurface
        .flatMap((language) => language.securitySurfaceExamples)
        .slice(0, MAX_SECURITY_SURFACE_EXAMPLES);
    const exampleLabel = examples.join(', ');
    const counts = formatLanguageCounts(summary.languages);
    const languagesLabel = formatLanguageList(summary.languages.map((item) => item.language));
    return {
        ruleId: exports.SCAN_LANGUAGE_COVERAGE_RULE_ID,
        severity: 'warning',
        confidence: 'high',
        file: examples[0],
        message: `${counts} ${verbForCount(summary.totalFiles)} not analysed — Assurly's rules cover JavaScript, TypeScript and SQL. They include payment and authentication code (${exampleLabel}), so this verdict says nothing about that layer.`,
        suggestion: `Review the ${languagesLabel} backend by hand before shipping — Stripe webhook signature verification, auth middleware and database access there were not checked.`,
    };
}
function formatLanguageList(languages) {
    if (languages.length === 1)
        return languages[0];
    if (languages.length === 2)
        return `${languages[0]} and ${languages[1]}`;
    return `${languages.slice(0, -1).join(', ')} and ${languages[languages.length - 1]}`;
}
function formatUnanalyzedLogLine(summary) {
    if (summary.totalFiles === 0)
        return null;
    const counts = summary.languages
        .map((item) => `${item.fileCount} ${item.language} file(s)`)
        .join(', ');
    return `${counts} not analysed — Assurly rules cover JS/TS/SQL.`;
}
