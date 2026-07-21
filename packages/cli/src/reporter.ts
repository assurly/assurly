import chalk from 'chalk';
import { Finding } from './types';
import {
  detectTerminalCapabilities,
  frameBottom,
  frameTop,
  type TerminalCapabilities,
} from './terminalUi';

/**
 * Renders the scan results in a clean, color-coded, professional console layout.
 */
export function reportFindings(
  findings: Finding[],
  caps: TerminalCapabilities = detectTerminalCapabilities(),
): void {
  console.log('\n' + chalk.dim(frameTop('Scan Results', caps)) + '\n');

  if (findings.length === 0) {
    console.log(chalk.bold.green('  ✔ Success! No configuration or security issues found.'));
    console.log(chalk.green('    Your project is production-ready! 🚀\n'));
    return;
  }

  // Group findings by file for cleaner console output
  const groupedFindings: { [file: string]: Finding[] } = {};
  const globalFindings: Finding[] = [];

  for (const finding of findings) {
    if (finding.file) {
      if (!groupedFindings[finding.file]) {
        groupedFindings[finding.file] = [];
      }
      groupedFindings[finding.file].push(finding);
    } else {
      globalFindings.push(finding);
    }
  }

  // Print global findings first
  if (globalFindings.length > 0) {
    console.log(chalk.bold.underline('Global Configurations:'));
    for (const finding of globalFindings) {
      printFinding(finding);
    }
    console.log('');
  }

  // Print file-specific findings
  for (const file of Object.keys(groupedFindings)) {
    console.log(chalk.bold.underline(`File: ${file}`));
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
  console.log(chalk.dim(frameBottom(caps)));
  console.log(chalk.dim('  See the Ship Gate verdict below for the deploy decision.'));
}

/**
 * Format and print a single finding.
 */
function printFinding(finding: Finding): void {
  const badge =
    finding.severity === 'error'
      ? chalk.bold.bgRed.white(' ERROR ')
      : chalk.bold.bgYellow.black(' WARN  ');

  const lineInfo = finding.line ? chalk.gray(`:L${finding.line}`) : '';
  const fileInfo = finding.file ? chalk.blue(`[${finding.file}${lineInfo}] `) : '';

  console.log(`  ${badge} ${fileInfo}${finding.message}`);
  if (finding.suggestion) {
    console.log(chalk.gray(`           💡 Suggestion: ${finding.suggestion}`));
  }
}
