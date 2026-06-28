"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCliShipGateReport = buildCliShipGateReport;
exports.printShipGateSummary = printShipGateSummary;
const chalk_1 = __importDefault(require("chalk"));
const scanner_core_1 = require("@shipready/scanner-core");
function toShipGateFinding(finding) {
    return {
        ruleId: finding.ruleId,
        severity: finding.severity,
        message: finding.message,
        file: finding.file,
        line: finding.line,
    };
}
function buildCliShipGateReport(findings, scannedFileCount) {
    const affectedPaths = new Set(findings.map((finding) => finding.file).filter((file) => Boolean(file)));
    const options = {
        scannedFileCount,
        cleanFileCount: Math.max(0, scannedFileCount - affectedPaths.size),
    };
    return (0, scanner_core_1.buildShipGateReport)(findings.map(toShipGateFinding), options);
}
function printShipGateSummary(report) {
    console.log('\n' + chalk_1.default.bold.cyan('=================================================='));
    console.log(chalk_1.default.bold.cyan('                  Ship Gate                       '));
    console.log(chalk_1.default.bold.cyan('==================================================') + '\n');
    const statusColor = report.status === 'blocked'
        ? chalk_1.default.bold.red
        : report.status === 'review'
            ? chalk_1.default.bold.yellow
            : chalk_1.default.bold.green;
    console.log(statusColor(`${report.statusEmoji} ${report.headline}${' '.repeat(Math.max(1, 24 - report.headline.length))}Ship Score: ${report.shipScore}/100`));
    console.log('');
    const plain = (0, scanner_core_1.formatShipGatePlainText)(report).split('\n').slice(1);
    for (const line of plain) {
        if (line.startsWith('Blockers')) {
            console.log(chalk_1.default.bold.red(line));
        }
        else if (line.startsWith('Warnings')) {
            console.log(chalk_1.default.bold.yellow(line));
        }
        else if (line.startsWith('  ')) {
            console.log(report.status === 'blocked' && line.match(/^\s+\d+\./) ? chalk_1.default.red(line) : line);
        }
        else if (line.startsWith('✓')) {
            console.log(chalk_1.default.green(line));
        }
        else {
            console.log(line);
        }
    }
    console.log('');
}
