import type { ShipReceiptInput } from './shipLoopTypes';

/**
 * Builds a client-safe Ship Receipt. Metadata only — never include source paths or code.
 */
export function buildShipReceiptMarkdown(input: ShipReceiptInput): string {
  const statusLabel =
    input.status === 'ready'
      ? 'READY TO SHIP'
      : input.status === 'blocked'
        ? 'NOT READY TO SHIP'
        : input.status === 'review'
          ? 'REVIEW RECOMMENDED'
          : 'NO FILES SCANNED';

  const project = input.projectName.trim() || 'snippet scan';

  return [
    '# Assurly Ship Receipt',
    `Status: ${statusLabel}`,
    `Ship Score: ${input.shipScore}/100`,
    `Scanned: ${input.scannedFileCount} files · Clean: ${input.cleanFileCount}`,
    `Blockers: ${input.blockerCount} · Warnings: ${input.warningCount}`,
    `Local auto-fixes applied: ${input.appliedFixCount}`,
    `Generated: ${input.generatedAt}`,
    `Project: ${project}`,
    '',
    input.status === 'ready'
      ? 'Checks passed with no open blockers.'
      : 'This receipt reflects the current Manual Checker Ship Gate status.',
    'Source code was not uploaded — this receipt is metadata only.',
  ].join('\n');
}
