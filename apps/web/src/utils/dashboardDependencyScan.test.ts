import { describe, expect, it, vi } from 'vitest';
import {
  DEP_DEFAULT_EVAL_CAP,
  DEP_NONEXISTENT_PACKAGE,
  DEP_REGISTRY_UNAVAILABLE,
  DEP_SCAN_CAPPED,
  DEP_SLOPSQUAT_SUSPECT,
} from '@assurly/scanner-core';
import { scanDashboardDependencies } from './dashboardDependencyScan';
import { scanPrNewDependencies } from './prDependencyScan';

/** Captured shape of react-codeshift (2026-07-26) — one version, no repository. */
const REACT_CODESHIFT_REGISTRY = {
  name: 'react-codeshift',
  description: '🚫 Placeholder to prevent dependency confusion.',
  time: { created: '2026-01-14T21:02:51.762Z', modified: '2026-01-14T21:02:52.176Z' },
  versions: { '1.0.0': { version: '1.0.0' } },
  repository: null,
};

describe('scanDashboardDependencies', () => {
  it('matches the PR-path verdict for an identical newly added package', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('registry.npmjs.org')) {
        return Response.json(REACT_CODESHIFT_REGISTRY);
      }
      return Response.json({ downloads: 1 });
    });
    const registry = { fetchImpl: fetchImpl as unknown as typeof fetch };

    const dashboard = await scanDashboardDependencies({
      packageJson: JSON.stringify({
        dependencies: { 'react-codeshift': '^1.0.0' },
      }),
      registry,
    });
    const pr = await scanPrNewDependencies({
      basePackageJson: JSON.stringify({ dependencies: {} }),
      headPackageJson: JSON.stringify({
        dependencies: { 'react-codeshift': '^1.0.0' },
      }),
      registry,
    });

    const dashBlocker = dashboard.findings.find((f) => f.ruleId === DEP_SLOPSQUAT_SUSPECT);
    const prBlocker = pr.findings.find((f) => f.ruleId === DEP_SLOPSQUAT_SUSPECT);
    expect(dashBlocker).toBeDefined();
    expect(prBlocker).toBeDefined();
    expect(dashBlocker!.severity).toBe(prBlocker!.severity);
    expect(dashBlocker!.confidence).toBe(prBlocker!.confidence);
    expect(dashBlocker!.message).toBe(prBlocker!.message);
    expect(dashBlocker!.suggestion).toBe(prBlocker!.suggestion);
  });

  it('still blocks nonexistent packages', async () => {
    const fetchImpl = vi.fn(async () => new Response('Not Found', { status: 404 }));
    const result = await scanDashboardDependencies({
      packageJson: JSON.stringify({
        dependencies: { 'never-published-pkg-xyz': '^1.0.0' },
      }),
      registry: { fetchImpl: fetchImpl as unknown as typeof fetch },
    });
    expect(result.findings.some((f) => f.ruleId === DEP_NONEXISTENT_PACKAGE)).toBe(true);
  });

  it('holds the evaluation cap and emits dep-scan-capped for large manifests', async () => {
    const names = Array.from({ length: DEP_DEFAULT_EVAL_CAP + 5 }, (_, i) => `pkg-${i}`);
    const deps = Object.fromEntries(names.map((name) => [name, '^1.0.0']));
    const fetchImpl = vi.fn(async () => new Response('Not Found', { status: 404 }));
    const result = await scanDashboardDependencies({
      packageJson: JSON.stringify({ dependencies: deps }),
      registry: { fetchImpl: fetchImpl as unknown as typeof fetch },
    });
    expect(result.findings.some((f) => f.ruleId === DEP_SCAN_CAPPED)).toBe(true);
    // Cap + one nonexistent finding per looked-up package (not hundreds beyond cap).
    const lookedUp = fetchImpl.mock.calls.filter((call) => {
      const input = call.at(0);
      return typeof input !== 'undefined' && String(input).includes('registry.npmjs.org');
    }).length;
    expect(lookedUp).toBeLessThanOrEqual(DEP_DEFAULT_EVAL_CAP);
  });

  it('degrades to registry-unavailable warnings when every outbound call fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const result = await scanDashboardDependencies({
      packageJson: JSON.stringify({
        dependencies: { 'react-codeshift': '^1.0.0', 'another-pkg': '^1.0.0' },
      }),
      registry: { fetchImpl: fetchImpl as unknown as typeof fetch },
    });
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.every((f) => f.ruleId === DEP_REGISTRY_UNAVAILABLE)).toBe(true);
    expect(result.findings.every((f) => f.severity === 'warning')).toBe(true);
  });

  it('returns empty findings when package.json is missing (does not throw)', async () => {
    const result = await scanDashboardDependencies({ packageJson: null });
    expect(result).toEqual({ declaredDependencies: [], findings: [] });
  });
});
