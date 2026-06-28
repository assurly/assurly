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
    // Count errors and warnings
    const errorCount = findings.filter((f) => f.severity === 'error').length;
    const warningCount = findings.filter((f) => f.severity === 'warning').length;
    console.log(chalk_1.default.bold.cyan('--------------------------------------------------'));
    if (errorCount > 0) {
        console.log(chalk_1.default.bold.red(`  ❌ Scan Failed: Found ${errorCount} error(s) and ${warningCount} warning(s).`));
        console.log(chalk_1.default.red('     Please fix the errors before deploying to production.\n'));
    }
    else {
        console.log(chalk_1.default.bold.yellow(`  ⚠️ Scan Passed with warnings: Found ${warningCount} warning(s).`));
        console.log(chalk_1.default.yellow('     Review warnings, but you are cleared for deployment.\n'));
    }
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
