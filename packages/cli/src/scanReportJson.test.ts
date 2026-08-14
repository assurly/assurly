import { describe, expect, it } from 'vitest';
import {
  ASSURLY_SCAN_REPORT_VERSION,
  buildAssurlyScanReportJson,
  extractFindingsFromScanJson,
} from './scanReportJson';
import type { ScanProjectResult } from './scanProject';

function sampleResult(): ScanProjectResult {
  return {
    findings: [
      {
        ruleId: 'supabase-rls',
        severity: 'error',
        confidence: 'high',
        file: 'schema.sql',
        line: 1,
        message: 'RLS missing',
      },
    ],
    report: {
      status: 'blocked',
      shipScore: 88,
      headline: 'NOT READY TO SHIP',
      statusEmoji: '🚫',
      blockers: [],
      reviews: [],
      warnings: [],
      cleanFileCount: 0,
      scannedFileCount: 1,
      totalErrorFindings: 1,
      totalWarningFindings: 0,
    },
    context: {
      projectPath: '/tmp/app',
      files: ['schema.sql'],
      detectedStack: {
        framework: 'nextjs',
        database: 'supabase',
        payments: 'none',
        deployment: 'vercel',
      },
      scanScope: { scanned: 1, skipped: 0, roots: ['.'] },
    },
    summary: '',
    markdown: '',
  };
}

describe('scanReportJson', () => {
  it('builds a versioned Ship Gate report for --json', () => {
    const json = buildAssurlyScanReportJson(sampleResult());
    expect(json.version).toBe(ASSURLY_SCAN_REPORT_VERSION);
    expect(json.shipScore).toBe(88);
    expect(json.status).toBe('blocked');
    expect(json.findings).toHaveLength(1);
    expect(json.scannedFileCount).toBe(1);
  });

  it('extracts findings from legacy arrays and versioned objects', () => {
    const finding = sampleResult().findings[0]!;
    expect(extractFindingsFromScanJson([finding])).toEqual([finding]);
    expect(extractFindingsFromScanJson(buildAssurlyScanReportJson(sampleResult()))).toEqual([
      finding,
    ]);
  });
});
