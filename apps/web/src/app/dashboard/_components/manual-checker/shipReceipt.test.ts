import { describe, expect, it } from 'vitest';
import { buildShipReceiptMarkdown } from './shipReceipt';

describe('buildShipReceiptMarkdown', () => {
  it('includes READY status, score, and no-upload line without source content', () => {
    const markdown = buildShipReceiptMarkdown({
      status: 'ready',
      shipScore: 100,
      blockerCount: 0,
      warningCount: 0,
      scannedFileCount: 4,
      cleanFileCount: 4,
      appliedFixCount: 3,
      projectName: 'demo',
      generatedAt: '2026-08-10T10:00:00.000Z',
    });

    expect(markdown).toContain('# Assurly Ship Receipt');
    expect(markdown).toContain('Status: READY TO SHIP');
    expect(markdown).toContain('Ship Score: 100/100');
    expect(markdown).toContain('Scanned: 4 files · Clean: 4');
    expect(markdown).toContain('Local auto-fixes applied: 3');
    expect(markdown).toContain('Project: demo');
    expect(markdown).toContain('Generated: 2026-08-10T10:00:00.000Z');
    expect(markdown).toContain('Checks passed with no open blockers.');
    expect(markdown).toContain('Source code was not uploaded — this receipt is metadata only.');
    expect(markdown).not.toContain('create table');
    expect(markdown).not.toContain('process.env');
    expect(markdown).not.toContain('demo/app/api');
  });

  it('falls back to snippet scan when project name is blank', () => {
    const markdown = buildShipReceiptMarkdown({
      status: 'ready',
      shipScore: 100,
      blockerCount: 0,
      warningCount: 0,
      scannedFileCount: 1,
      cleanFileCount: 1,
      appliedFixCount: 0,
      projectName: '  ',
      generatedAt: '2026-08-10T10:00:00.000Z',
    });

    expect(markdown).toContain('Project: snippet scan');
  });

  it('keeps a stable field order for ready receipts', () => {
    const markdown = buildShipReceiptMarkdown({
      status: 'ready',
      shipScore: 96,
      blockerCount: 0,
      warningCount: 0,
      scannedFileCount: 2,
      cleanFileCount: 2,
      appliedFixCount: 1,
      projectName: 'app',
      generatedAt: '2026-08-10T11:00:00.000Z',
    });

    const statusAt = markdown.indexOf('Status:');
    const scoreAt = markdown.indexOf('Ship Score:');
    const scannedAt = markdown.indexOf('Scanned:');
    expect(statusAt).toBeGreaterThan(-1);
    expect(scoreAt).toBeGreaterThan(statusAt);
    expect(scannedAt).toBeGreaterThan(scoreAt);
  });
});
