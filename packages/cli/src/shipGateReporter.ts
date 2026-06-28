import chalk from 'chalk';
import {
  buildShipGateReport,
  formatShipGatePlainText,
  type ShipGateFindingInput,
  type ShipGateOptions,
  type ShipGateReport,
} from '@shipready/scanner-core';
import type { Finding } from './types';

function toShipGateFinding(finding: Finding): ShipGateFindingInput {
  return {
    ruleId: finding.ruleId,
    severity: finding.severity,
    message: finding.message,
    file: finding.file,
    line: finding.line,
  };
}

export function buildCliShipGateReport(
  findings: Finding[],
  scannedFileCount: number,
): ShipGateReport {
  const affectedPaths = new Set(
    findings.map((finding) => finding.file).filter((file): file is string => Boolean(file)),
  );
  const options: ShipGateOptions = {
    scannedFileCount,
    cleanFileCount: Math.max(0, scannedFileCount - affectedPaths.size),
  };
  return buildShipGateReport(findings.map(toShipGateFinding), options);
}

export function printShipGateSummary(report: ShipGateReport): void {
  console.log('\n' + chalk.bold.cyan('=================================================='));
  console.log(chalk.bold.cyan('                  Ship Gate                       '));
  console.log(chalk.bold.cyan('==================================================') + '\n');

  const statusColor =
    report.status === 'blocked'
      ? chalk.bold.red
      : report.status === 'review'
        ? chalk.bold.yellow
        : chalk.bold.green;

  console.log(
    statusColor(
      `${report.statusEmoji} ${report.headline}${' '.repeat(Math.max(1, 24 - report.headline.length))}Ship Score: ${report.shipScore}/100`,
    ),
  );
  console.log('');

  const plain = formatShipGatePlainText(report).split('\n').slice(1);
  for (const line of plain) {
    if (line.startsWith('Blockers')) {
      console.log(chalk.bold.red(line));
    } else if (line.startsWith('Warnings')) {
      console.log(chalk.bold.yellow(line));
    } else if (line.startsWith('  ')) {
      console.log(report.status === 'blocked' && line.match(/^\s+\d+\./) ? chalk.red(line) : line);
    } else if (line.startsWith('✓')) {
      console.log(chalk.green(line));
    } else {
      console.log(line);
    }
  }

  console.log('');
}
