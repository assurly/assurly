import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The dashboard scan and the free landing scan are independent implementations.
 * Agent-stack rules shipped inert once before because only one path was wired.
 * These guards fail if either path drops `scanAgentStack` again.
 */
const dashboardSource = readFileSync(
  new URL('../app/dashboard/_components/DashboardClient.tsx', import.meta.url),
  'utf8',
);
const homeSource = readFileSync(
  new URL('../app/_components/home/HomeClient.tsx', import.meta.url),
  'utf8',
);
const browserScannerSource = readFileSync(new URL('./browserScanner.ts', import.meta.url), 'utf8');

describe('agent stack web wiring', () => {
  it('re-exports agent scanners from browserScanner', () => {
    expect(browserScannerSource).toContain('scanAgentStack');
    expect(browserScannerSource).toContain('isAgentStackFile');
  });

  it('invokes agent scanners from both the dashboard and free landing scan paths', () => {
    expect(dashboardSource).toContain('scanAgentStack');
    expect(dashboardSource).toContain('isAgentStackFile');
    expect(dashboardSource).toContain('agentFiles');

    expect(homeSource).toContain('scanAgentStack');
    expect(homeSource).toContain('isAgentStackFile');
    expect(homeSource).toContain('agentFiles');
  });
});
