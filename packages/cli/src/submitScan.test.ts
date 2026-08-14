import { describe, expect, it, vi } from 'vitest';
import { buildAssurlyScanReportJson } from './scanReportJson';
import { submitScanReport } from './submitScan';
import type { ScanProjectResult } from './scanProject';

describe('submitScanReport', () => {
  it('POSTs findings + SoT without source paths beyond finding.file', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        repo: string;
        shipScore: number;
        findings: unknown[];
      };
      expect(body.repo).toBe('acme/saas');
      expect(body.shipScore).toBe(100);
      expect(body.findings).toEqual([]);
      return new Response(JSON.stringify({ id: 'scan-1', shipScore: 100, verdict: 'ready' }), {
        status: 201,
      });
    }) as typeof fetch;

    const result: ScanProjectResult = {
      findings: [],
      report: {
        status: 'ready',
        shipScore: 100,
        headline: 'READY TO SHIP',
        statusEmoji: '✅',
        blockers: [],
        reviews: [],
        warnings: [],
        cleanFileCount: 3,
        scannedFileCount: 3,
        totalErrorFindings: 0,
        totalWarningFindings: 0,
      },
      context: {
        projectPath: '/tmp/app',
        files: ['a.ts', 'b.ts', 'c.ts'],
        detectedStack: {
          framework: 'nextjs',
          database: 'none',
          payments: 'none',
          deployment: 'vercel',
        },
      },
      summary: '',
      markdown: '',
    };

    const submitted = await submitScanReport({
      apiKey: 'ask_test',
      apiBaseUrl: 'https://assurly.dev',
      repo: 'acme/saas',
      report: buildAssurlyScanReportJson(result),
      fetchImpl,
    });
    expect(submitted).toEqual({ id: 'scan-1', shipScore: 100, verdict: 'ready' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
