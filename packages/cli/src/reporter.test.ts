import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { reportFindings } from './reporter';
import type { Finding } from './types';

describe('reportFindings', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function loggedOutput(): string {
    return logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
  }

  it('does not print a blocking pass/fail verdict for error-severity findings', () => {
    const findings: Finding[] = [
      {
        ruleId: 'rsc-data-leaks',
        severity: 'error',
        message: "Client Component imports server-side module '../db'.",
        file: 'app/foo.tsx',
        line: 3,
      },
    ];

    reportFindings(findings);

    const output = loggedOutput();
    expect(output).not.toMatch(/scan failed/i);
    expect(output).not.toMatch(/fix the errors before deploying/i);
    expect(output).toMatch(/Ship Gate verdict below/i);
  });

  it('still lists each finding grouped by file with its message and suggestion', () => {
    const findings: Finding[] = [
      {
        ruleId: 'supabase-rls',
        severity: 'error',
        message: 'Missing RLS.',
        file: 'db/schema.sql',
        line: 1,
        suggestion: 'Enable RLS.',
      },
    ];

    reportFindings(findings);

    const output = loggedOutput();
    expect(output).toContain('db/schema.sql');
    expect(output).toContain('Missing RLS.');
    expect(output).toContain('Enable RLS.');
  });

  it('prints a success message and returns early when there are no findings', () => {
    reportFindings([]);

    const output = loggedOutput();
    expect(output).toMatch(/no configuration or security issues found/i);
    expect(output).not.toMatch(/ship gate verdict below/i);
  });

  it('does not print a blocking verdict for warning-only findings either', () => {
    const findings: Finding[] = [
      {
        ruleId: 'cold-start-optimization',
        severity: 'warning',
        message: 'Heavy import detected.',
        file: 'app/api/route.ts',
      },
    ];

    reportFindings(findings);

    const output = loggedOutput();
    expect(output).not.toMatch(/scan failed/i);
    expect(output).not.toMatch(/scan passed with warnings/i);
  });
});
