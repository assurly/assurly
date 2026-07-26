import { describe, expect, it, vi } from 'vitest';
import {
  DEP_NONEXISTENT_PACKAGE,
  DEP_REGISTRY_UNAVAILABLE,
  DEP_SLOPSQUAT_SUSPECT,
} from '@assurly/scanner-core';
import { scanPrNewDependencies } from './prDependencyScan';

/** Captured shape of react-codeshift (2026-07-26) — one version, no repository. */
const REACT_CODESHIFT_REGISTRY = {
  name: 'react-codeshift',
  description: '🚫 Placeholder to prevent dependency confusion.',
  time: { created: '2026-01-14T21:02:51.762Z', modified: '2026-01-14T21:02:52.176Z' },
  versions: { '1.0.0': { version: '1.0.0' } },
  repository: null,
};

describe('scanPrNewDependencies', () => {
  it('acceptance: a PR adding react-codeshift produces a slopsquat blocker from real registry shape', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('registry.npmjs.org')) {
        return Response.json(REACT_CODESHIFT_REGISTRY);
      }
      return Response.json({ downloads: 1 });
    });
    const result = await scanPrNewDependencies({
      basePackageJson: JSON.stringify({
        dependencies: { react: '^18.0.0' },
      }),
      headPackageJson: JSON.stringify({
        dependencies: { react: '^18.0.0', 'react-codeshift': '^1.0.0' },
      }),
      registry: { fetchImpl: fetchImpl as unknown as typeof fetch },
    });

    expect(result.addedDependencies).toEqual(['react-codeshift']);
    const blocker = result.findings.find((f) => f.ruleId === DEP_SLOPSQUAT_SUSPECT);
    expect(blocker).toBeDefined();
    expect(blocker!.severity).toBe('error');
    expect(blocker!.confidence).toBe('high');
    expect(blocker!.message).toContain('react-codeshift');
    expect(blocker!.message).toMatch(/borrows|slopsquat/i);
    expect(blocker!.message).toMatch(/react/);
  });

  it('still blocks nonexistent packages via dep-nonexistent-package', async () => {
    const fetchImpl = vi.fn(async () => new Response('Not Found', { status: 404 }));
    const result = await scanPrNewDependencies({
      basePackageJson: JSON.stringify({ dependencies: {} }),
      headPackageJson: JSON.stringify({
        dependencies: { 'never-published-pkg-xyz': '^1.0.0' },
      }),
      registry: { fetchImpl: fetchImpl as unknown as typeof fetch },
    });
    expect(result.findings.some((f) => f.ruleId === DEP_NONEXISTENT_PACKAGE)).toBe(true);
  });

  it('does not re-evaluate dependencies already on the base ref', async () => {
    const fetchImpl = vi.fn();
    const result = await scanPrNewDependencies({
      basePackageJson: JSON.stringify({
        dependencies: { react: '^18.0.0', lodash: '^4.0.0' },
      }),
      headPackageJson: JSON.stringify({
        dependencies: { react: '^18.0.0', lodash: '^4.0.0' },
      }),
      registry: { fetchImpl: fetchImpl as unknown as typeof fetch },
    });
    expect(result.addedDependencies).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not block a legitimate young package with real downloads', async () => {
    const created = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('registry.npmjs.org')) {
        return new Response(
          JSON.stringify({
            time: { created },
            versions: { '0.1.0': {}, '0.2.0': {} },
            repository: { type: 'git', url: 'https://github.com/acme/legit-new-lib.git' },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ downloads: 12_000 }), { status: 200 });
    });
    const result = await scanPrNewDependencies({
      basePackageJson: JSON.stringify({ dependencies: {} }),
      headPackageJson: JSON.stringify({
        dependencies: { 'legit-new-lib': '^0.1.0' },
      }),
      registry: { fetchImpl: fetchImpl as unknown as typeof fetch },
    });
    expect(result.findings.some((f) => f.severity === 'error')).toBe(false);
    expect(result.findings.some((f) => f.ruleId === DEP_SLOPSQUAT_SUSPECT)).toBe(false);
  });

  it('degrades to registry-unavailable warnings when every outbound call fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const result = await scanPrNewDependencies({
      basePackageJson: JSON.stringify({ dependencies: {} }),
      headPackageJson: JSON.stringify({
        dependencies: { 'react-codeshift': '^1.0.0', 'another-pkg': '^1.0.0' },
      }),
      registry: { fetchImpl: fetchImpl as unknown as typeof fetch },
    });
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.every((f) => f.ruleId === DEP_REGISTRY_UNAVAILABLE)).toBe(true);
    expect(result.findings.every((f) => f.severity === 'warning')).toBe(true);
  });
});
