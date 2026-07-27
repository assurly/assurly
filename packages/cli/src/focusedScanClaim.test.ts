import { describe, expect, it, vi } from 'vitest';
import { reportFindings, type ScanSurface } from './reporter';
import type { Finding } from './types';

const PLAIN = { unicode: false, color: false, hyperlinks: false, width: 80 } as never;

function capture(findings: Finding[], surface?: ScanSurface): string {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  try {
    reportFindings(findings, PLAIN, surface);
  } finally {
    spy.mockRestore();
  }
  return lines.join('\n');
}

describe('focused scan claims', () => {
  /**
   * The bug this exists for: `assurly scan --supply` printed "Your project is
   * production-ready" and a READY TO SHIP verdict for a project that a full scan
   * reported as NOT READY with blockers. A focused run examines one narrow
   * surface and cannot speak for the rest — and a ship gate that overstates its
   * own scope is the failure this tool exists to prevent.
   */
  it('never calls a project production-ready from a focused scan', () => {
    const output = capture([], { label: 'install-time trust', flag: '--supply' });

    expect(output).not.toMatch(/production-ready/i);
    expect(output).not.toMatch(/no configuration or security issues found/i);
    expect(output).toMatch(/no install-time trust issues found/i);
  });

  it('names the surface it examined and points at the full scan', () => {
    const output = capture([], { label: 'agent stack', flag: '--agent' });

    expect(output).toContain('--agent');
    expect(output).toMatch(/full ship gate|assurly scan/i);
  });

  it('still speaks for the whole project on an unfocused scan', () => {
    const output = capture([]);

    expect(output).toMatch(/production-ready/i);
    expect(output).not.toMatch(/focused scan/i);
  });

  it('reports findings normally in focused mode', () => {
    const finding: Finding = {
      ruleId: 'supply-allowscripts-unpinned',
      severity: 'warning',
      message: 'allowScripts entry "sharp" grants every version',
      file: 'package.json',
      line: 5,
    };
    const output = capture([finding], { label: 'install-time trust', flag: '--supply' });

    // The renderer prints severity, location and message — not the rule id.
    expect(output).toContain('allowScripts entry "sharp" grants every version');
    expect(output).toContain('package.json');
    expect(output).not.toMatch(/no install-time trust issues found/i);
  });
});
