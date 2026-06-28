import chalk from 'chalk';
import { Finding } from './types';

/**
 * Renders the scan results in a clean, color-coded, professional console layout.
 */
export function reportFindings(findings: Finding[]): void {
  console.log('\n' + chalk.bold.cyan('=================================================='));
  console.log(chalk.bold.cyan('             ShipReady Scan Results               '));
  console.log(chalk.bold.cyan('==================================================') + '\n');

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

  // Count errors and warnings
  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;

  console.log(chalk.bold.cyan('--------------------------------------------------'));
  if (errorCount > 0) {
    console.log(
      chalk.bold.red(
        `  ❌ Scan Failed: Found ${errorCount} error(s) and ${warningCount} warning(s).`,
      ),
    );
    console.log(chalk.red('     Please fix the errors before deploying to production.\n'));
  } else {
    console.log(
      chalk.bold.yellow(`  ⚠️ Scan Passed with warnings: Found ${warningCount} warning(s).`),
    );
    console.log(chalk.yellow('     Review warnings, but you are cleared for deployment.\n'));
  }
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
