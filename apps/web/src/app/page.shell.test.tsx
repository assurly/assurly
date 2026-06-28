import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import HomeClient from './_components/home/HomeClient';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

describe('Home route SSR shell', () => {
  it('does not ship a route-level loading fallback alongside the landing page', () => {
    const loadingPath = join(process.cwd(), 'src/app/loading.tsx');
    expect(() => readFileSync(loadingPath)).toThrow();
  });

  it('renders a single primary navigation landmark without empty class attributes', () => {
    const html = renderToString(
      <HomeClient initialAuthenticated={false} loginUrl="http://localhost:3000/api/auth/login" />,
    );

    expect(html.match(/id="primary-navigation"/g)?.length).toBe(1);
    expect(html).not.toContain('class=""');
    expect(html).toContain('href="#features"');
    expect(html).toContain('href="http://localhost:3000/api/auth/login"');
  });
});
