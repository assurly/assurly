import chalk from 'chalk';
import {
  detectTerminalCapabilities,
  frameBottom,
  frameTop,
  hyperlink,
  scoreMeter,
  type TerminalCapabilities,
} from './terminalUi';
import {
  buildShipGateReport,
  formatScanScopeSummary,
  formatShipGatePlainText,
  type ShipGateFindingInput,
  type ShipGateOptions,
  type ShipGateReport,
} from '@assurly/scanner-core';
import type { Finding } from './types';

const ASSURLY_URL = 'https://assurly.dev';

function toShipGateFinding(finding: Finding): ShipGateFindingInput {
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

export function buildCliShipGateReport(
  findings: Finding[],
  scannedFileCount: number,
  scanScope?: ShipGateOptions['scanScope'],
): ShipGateReport {
  const affectedPaths = new Set(
    findings.map((finding) => finding.file).filter((file): file is string => Boolean(file)),
  );
  const options: ShipGateOptions = {
    scannedFileCount,
    cleanFileCount: Math.max(0, scannedFileCount - affectedPaths.size),
    scanScope,
  };
  return buildShipGateReport(findings.map(toShipGateFinding), options);
}

export function printShipGateSummary(
  report: ShipGateReport,
  caps: TerminalCapabilities = detectTerminalCapabilities(),
): void {
  const statusColor =
    report.status === 'blocked'
      ? chalk.bold.red
      : report.status === 'review'
        ? chalk.bold.yellow
        : chalk.bold.green;
  const dim = chalk.dim;

  console.log('\n' + dim(frameTop('Ship Gate', caps)) + '\n');

  // Verdict and score on one line, the score right-aligned to the frame. `headline` and
  // the emoji vary in width, so pad from the measured content rather than a fixed column.
  const verdict = `${report.statusEmoji} ${report.headline}`;
  const score = `${report.shipScore}/100`;
  const gap = Math.max(2, caps.width - 2 - verdict.length - score.length);
  console.log(`  ${statusColor(verdict)}${' '.repeat(gap)}${statusColor(score)}`);

  // A quiet meter under the verdict, sized to the frame.
  console.log(`  ${statusColor(scoreMeter(report.shipScore, caps, caps.width - 4))}`);

  if (report.scanScope) {
    console.log(dim(`  ${formatScanScopeSummary(report.scanScope).trim()}`));
  }
  console.log('');

  const plain = formatShipGatePlainText(report)
    .split('\n')
    .slice(report.scanScope ? 2 : 1);
  for (const line of plain) {
    // Indent the body to sit inside the frame, but never indent blank lines.
    const indented = line.length > 0 ? `  ${line}` : line;
    if (line.startsWith('Blockers')) {
      console.log(chalk.bold.red(indented));
    } else if (line.startsWith('Review')) {
      console.log(chalk.bold.yellow(indented));
    } else if (line.startsWith('Warnings')) {
      console.log(chalk.bold.yellow(indented));
    } else if (line.startsWith('  ')) {
      console.log(
        report.status === 'blocked' && line.match(/^\s+\d+\./) ? chalk.red(indented) : indented,
      );
    } else if (line.startsWith('✓')) {
      console.log(chalk.green(indented));
    } else {
      console.log(indented);
    }
  }

  console.log('\n' + dim(frameBottom(caps)));
  console.log(
    dim(`  Full report, auto-fix and monitoring: ${hyperlink('assurly.dev', ASSURLY_URL, caps)}\n`),
  );
}
