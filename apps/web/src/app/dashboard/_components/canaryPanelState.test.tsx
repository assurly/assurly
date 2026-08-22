import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard',
}));

import { renderCanaryPanel } from './DashboardClient';

const REPO = 'repo-1';

function textFor(
  lookup: Parameters<typeof renderCanaryPanel>[0],
  variant: Parameters<typeof renderCanaryPanel>[2] = 'settings',
): string {
  return renderToStaticMarkup(renderCanaryPanel(lookup, REPO, variant)).replace(/<[^>]+>/g, ' ');
}

describe('canary panel state', () => {
  it('never tells someone to scan a repository while the lookup is still in flight', () => {
    // The regression this exists for: a repository's target arrives on its own
    // request, so the map is empty for *every* repository during that window.
    // Reading emptiness as "not scanned" told people to scan repositories they
    // had already scanned, which reads as the feature being broken.
    const text = textFor({ status: 'loading', byRepoId: {} });

    expect(text).not.toMatch(/scan this repository once/i);
    expect(text).toMatch(/loading/i);
  });

  it('asks for a scan only once the lookup came back without a target', () => {
    const text = textFor({ status: 'ready', byRepoId: {} });
    expect(text).toMatch(/scan this repository once/i);
  });

  it('says the lookup failed rather than sitting on a loading state forever', () => {
    const text = textFor({ status: 'error', byRepoId: {} });
    expect(text).toMatch(/could not load/i);
    expect(text).not.toMatch(/scan this repository once/i);
    expect(text).not.toMatch(/loading/i);
  });

  it('renders the settings panel as soon as a target is known, whatever the status', () => {
    // A known target beats the status: a refetch triggered by a finished scan
    // flips status back to loading, and the panel must not collapse to a notice
    // under someone who was mid-interaction.
    for (const status of ['loading', 'ready', 'error'] as const) {
      const text = textFor({
        status,
        byRepoId: { [REPO]: 'a3f1c2d4-0000-4000-8000-000000000000' },
      });
      expect(text, `status=${status} collapsed the live panel`).toMatch(/issue canary/i);
    }
  });

  it('renders the silent-alarm CTA in the app workspace when a target is known', () => {
    const text = textFor(
      {
        status: 'ready',
        byRepoId: { [REPO]: 'a3f1c2d4-0000-4000-8000-000000000000' },
      },
      'alarm',
    );
    expect(text).toMatch(/add a silent alarm/i);
    expect(text).not.toMatch(/issue canary/i);
  });

  it('keeps every settings state under one accessible name so the panel never looks absent', () => {
    for (const lookup of [
      { status: 'loading' as const, byRepoId: {} },
      { status: 'ready' as const, byRepoId: {} },
      { status: 'error' as const, byRepoId: {} },
    ]) {
      const html = renderToStaticMarkup(renderCanaryPanel(lookup, REPO, 'settings'));
      expect(html).toContain('aria-label="Canary tokens"');
    }
  });
});
