// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HomeClient from './HomeClient';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

/**
 * The free scan on the landing page is the first verdict a visitor sees. It
 * must be the dashboard's verdict for the same repository, not a weaker one.
 */

const HEALTHY_TS_PROJECT: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'app', dependencies: { next: '16.4.3' } }),
  'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
  '.github/workflows/assurly.yml': 'jobs:\n  gate:\n    steps:\n      - run: npx assurly scan\n',
  'app/page.tsx': 'export default function Page() { return null; }\n',
};

/** GitHub as the landing scan sees it: one tree call, one batched content call. */
function stubPublicRepository(files: Record<string, string>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('type=tree')) {
        return Response.json({
          default_branch: 'main',
          tree: Object.keys(files).map((path) => ({ path, type: 'blob' })),
        });
      }
      if (url.endsWith('/api/github/public-scan') && init?.method === 'POST') {
        const { paths } = JSON.parse(String(init.body)) as { paths: string[] };
        return Response.json({
          files: paths.map((path) => ({ path, content: files[path] ?? null })),
        });
      }
      return new Response('{}', { status: 404 });
    }),
  );
}

/** The verdict headline of the scan just run, not the marketing samples around it. */
async function verdictHeadline(): Promise<string> {
  const title = await screen.findByText('Ship Gate for acme/app', {}, { timeout: 4000 });
  const card = title.closest('.scanner-results-card') as HTMLElement;
  const summary = within(card).getByRole('region', { name: 'Ship Gate readiness summary' });
  return summary.querySelector('.ship-gate-headline')?.textContent ?? '';
}

async function scanFromTheLandingPage(): Promise<void> {
  render(<HomeClient initialAuthenticated={false} />);
  fireEvent.change(screen.getByLabelText('Public GitHub repository'), {
    target: { value: 'acme/app' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Scan Repository' }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('landing page free scan', () => {
  it('blocks a service-role client that skips every access check', async () => {
    // The landing scan used to skip this rule and called the repository ready.
    stubPublicRepository({
      ...HEALTHY_TS_PROJECT,
      'lib/admin.ts': [
        "import { createClient } from '@supabase/supabase-js';",
        '',
        'export function purgeUsers() {',
        '  const admin = createClient(',
        "    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',",
        "    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',",
        '  );',
        "  return admin.from('users').delete().neq('id', '');",
        '}',
      ].join('\n'),
    });

    await scanFromTheLandingPage();

    expect(await verdictHeadline()).toMatch(/NOT READY TO SHIP/i);
  });

  it('asks for a review of an admin API route that never checks who is calling', async () => {
    stubPublicRepository({
      ...HEALTHY_TS_PROJECT,
      'app/api/admin/users/route.ts': [
        "import { db } from '@/lib/db';",
        '',
        'export async function GET(): Promise<Response> {',
        '  return Response.json(await db.users.findMany());',
        '}',
      ].join('\n'),
    });

    await scanFromTheLandingPage();

    expect(await verdictHeadline()).toMatch(/REVIEW RECOMMENDED/i);
  });

  it('does not block on missing RLS in a database no browser can reach', async () => {
    // Plain Postgres, no Supabase: the scanner files this as an unscored note.
    stubPublicRepository({
      ...HEALTHY_TS_PROJECT,
      'db/schema.sql': 'CREATE TABLE accounts (id serial PRIMARY KEY, name text);\n',
    });

    await scanFromTheLandingPage();

    expect(await verdictHeadline()).not.toMatch(/NOT READY TO SHIP/i);
  });
});
