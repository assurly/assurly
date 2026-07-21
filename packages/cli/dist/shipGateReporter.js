"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCliShipGateReport = buildCliShipGateReport;
exports.printShipGateSummary = printShipGateSummary;
const chalk_1 = __importDefault(require("chalk"));
const terminalUi_1 = require("./terminalUi");
const scanner_core_1 = require("@assurly/scanner-core");
const ASSURLY_URL = 'https://assurly.dev';
function toShipGateFinding(finding) {
    return {
        ruleId: finding.ruleId,
        severity: finding.severity,
        confidence: finding.confidence,
        message: finding.message,
        file: finding.file,
        line: finding.line,
        suggestion: finding.suggestion,
    };
}
function buildCliShipGateReport(findings, scannedFileCount, scanScope) {
    const affectedPaths = new Set(findings.map((finding) => finding.file).filter((file) => Boolean(file)));
    const options = {
        scannedFileCount,
        cleanFileCount: Math.max(0, scannedFileCount - affectedPaths.size),
        scanScope,
    };
    return (0, scanner_core_1.buildShipGateReport)(findings.map(toShipGateFinding), options);
}
function printShipGateSummary(report, caps = (0, terminalUi_1.detectTerminalCapabilities)()) {
    const statusColor = report.status === 'blocked'
        ? chalk_1.default.bold.red
        : report.status === 'review'
            ? chalk_1.default.bold.yellow
            : chalk_1.default.bold.green;
    const dim = chalk_1.default.dim;
    console.log('\n' + dim((0, terminalUi_1.frameTop)('Ship Gate', caps)) + '\n');
    // Verdict and score on one line, the score right-aligned to the frame. `headline` and
    // the emoji vary in width, so pad from the measured content rather than a fixed column.
    const verdict = `${report.statusEmoji} ${report.headline}`;
    const score = `${report.shipScore}/100`;
    const gap = Math.max(2, caps.width - 2 - verdict.length - score.length);
    console.log(`  ${statusColor(verdict)}${' '.repeat(gap)}${statusColor(score)}`);
    // A quiet meter under the verdict, sized to the frame.
    console.log(`  ${statusColor((0, terminalUi_1.scoreMeter)(report.shipScore, caps, caps.width - 4))}`);
    if (report.scanScope) {
        console.log(dim(`  ${(0, scanner_core_1.formatScanScopeSummary)(report.scanScope).trim()}`));
    }
    console.log('');
    const plain = (0, scanner_core_1.formatShipGatePlainText)(report)
        .split('\n')
        .slice(report.scanScope ? 2 : 1);
    for (const line of plain) {
        // Indent the body to sit inside the frame, but never indent blank lines.
        const indented = line.length > 0 ? `  ${line}` : line;
        if (line.startsWith('Blockers')) {
            console.log(chalk_1.default.bold.red(indented));
        }
        else if (line.startsWith('Review')) {
            console.log(chalk_1.default.bold.yellow(indented));
        }
        else if (line.startsWith('Warnings')) {
            console.log(chalk_1.default.bold.yellow(indented));
        }
        else if (line.startsWith('  ')) {
            console.log(report.status === 'blocked' && line.match(/^\s+\d+\./) ? chalk_1.default.red(indented) : indented);
        }
        else if (line.startsWith('✓')) {
            console.log(chalk_1.default.green(indented));
        }
        else {
            console.log(indented);
        }
    }
    console.log('\n' + dim((0, terminalUi_1.frameBottom)(caps)));
    console.log(dim(`  Full report, auto-fix and monitoring: ${(0, terminalUi_1.hyperlink)('assurly.dev', ASSURLY_URL, caps)}\n`));
}
