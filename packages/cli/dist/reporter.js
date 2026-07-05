"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportFindings = reportFindings;
const chalk_1 = __importDefault(require("chalk"));
/**
 * Renders the scan results in a clean, color-coded, professional console layout.
 */
function reportFindings(findings) {
    console.log('\n' + chalk_1.default.bold.cyan('=================================================='));
    console.log(chalk_1.default.bold.cyan('             ShipReady Scan Results               '));
    console.log(chalk_1.default.bold.cyan('==================================================') + '\n');
    if (findings.length === 0) {
        console.log(chalk_1.default.bold.green('  ✔ Success! No configuration or security issues found.'));
        console.log(chalk_1.default.green('    Your project is production-ready! 🚀\n'));
        return;
    }
    // Group findings by file for cleaner console output
    const groupedFindings = {};
    const globalFindings = [];
    for (const finding of findings) {
        if (finding.file) {
            if (!groupedFindings[finding.file]) {
                groupedFindings[finding.file] = [];
            }
            groupedFindings[finding.file].push(finding);
        }
        else {
            globalFindings.push(finding);
        }
    }
    // Print global findings first
    if (globalFindings.length > 0) {
        console.log(chalk_1.default.bold.underline('Global Configurations:'));
        for (const finding of globalFindings) {
            printFinding(finding);
        }
        console.log('');
    }
    // Print file-specific findings
    for (const file of Object.keys(groupedFindings)) {
        console.log(chalk_1.default.bold.underline(`File: ${file}`));
        for (const finding of groupedFindings[file]) {
            printFinding(finding);
        }
        console.log('');
    }
    // NB: this function intentionally does not print its own pass/fail verdict.
    // Raw finding.severity does not account for the confidence-aware Ship Gate
    // classification (see shipGate.ts), so a blanket "Scan Failed" summary here
    // could contradict the Ship Gate status printed right after (e.g. a
    // medium-confidence error-severity finding is a "review" item, not a
    // blocker). The ship/no-ship verdict is owned exclusively by
    // printShipGateSummary() in shipGateReporter.ts.
    console.log(chalk_1.default.bold.cyan('--------------------------------------------------'));
    console.log(chalk_1.default.gray('  See the Ship Gate verdict below for the deploy decision.\n'));
}
/**
 * Format and print a single finding.
 */
function printFinding(finding) {
    const badge = finding.severity === 'error'
        ? chalk_1.default.bold.bgRed.white(' ERROR ')
        : chalk_1.default.bold.bgYellow.black(' WARN  ');
    const lineInfo = finding.line ? chalk_1.default.gray(`:L${finding.line}`) : '';
    const fileInfo = finding.file ? chalk_1.default.blue(`[${finding.file}${lineInfo}] `) : '';
    console.log(`  ${badge} ${fileInfo}${finding.message}`);
    if (finding.suggestion) {
        console.log(chalk_1.default.gray(`           💡 Suggestion: ${finding.suggestion}`));
    }
}
