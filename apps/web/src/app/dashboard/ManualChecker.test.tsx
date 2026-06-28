import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ManualChecker from './ManualChecker';

describe('ManualChecker', () => {
  it('renders all supported scan modes', () => {
    const html = renderToStaticMarkup(<ManualChecker />);
    expect(html).toContain('Supabase Migration (.sql)');
    expect(html).toContain('Stripe');
    expect(html).toContain('Env Variables (.env)');
    expect(html).toContain('Project Folder / ZIP');
  });

  it('derives findings during render without an effect-driven state update', () => {
    const html = renderToStaticMarkup(<ManualChecker />);
    expect(html).toContain('Interactive Config Checker');
    expect(html).toContain('Errors');
    expect(html).toContain('Row-Level Security');
  });
});
