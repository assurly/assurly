"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitScanReport = submitScanReport;
const FINDINGS_LIMIT = 100;
function prioritizeFindings(findings) {
    const rank = (severity) => (severity === 'error' ? 0 : 1);
    return [...findings].sort((a, b) => rank(a.severity) - rank(b.severity)).slice(0, FINDINGS_LIMIT);
}
async function submitScanReport(options) {
    const base = options.apiBaseUrl.replace(/\/$/, '');
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(`${base}/api/v1/scans`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
            repo: options.repo,
            commitSha: options.commitSha,
            branch: options.branch,
            shipScore: options.report.shipScore,
            verdict: options.report.status,
            scannedFileCount: options.report.scannedFileCount,
            cleanFileCount: options.report.cleanFileCount,
            scanScope: options.report.scanScope,
            findings: prioritizeFindings(options.report.findings).map((finding) => ({
                ruleId: finding.ruleId,
                severity: finding.severity,
                confidence: finding.confidence,
                file: finding.file,
                line: finding.line,
                message: finding.message,
                suggestion: finding.suggestion,
            })),
        }),
    });
    const payload = (await response.json().catch(() => null));
    if (!response.ok) {
        const message = payload && typeof payload === 'object' && payload.error?.message
            ? payload.error.message
            : `Submit failed with HTTP ${response.status}`;
        throw new Error(message);
    }
    if (!payload?.id ||
        typeof payload.shipScore !== 'number' ||
        typeof payload.verdict !== 'string') {
        throw new Error('Submit succeeded but the response was missing Ship Gate fields.');
    }
    return { id: payload.id, shipScore: payload.shipScore, verdict: payload.verdict };
}
