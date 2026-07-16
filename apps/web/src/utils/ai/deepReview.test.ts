import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearAiCache, MODELS } from './claudeClient';
import { isDeepReviewWorthwhile, runDeepReview } from './deepReview';

describe('runDeepReview', () => {
  afterEach(() => {
    clearAiCache();
    vi.unstubAllEnvs();
  });

  it('returns null when paid tier is not allowed (Layer 1 unaffected)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await runDeepReview(
      [{ ruleId: 'runtime-supabase-rls-open', severity: 'error', message: 'open' }],
      { targetOrigin: 'https://app.example' },
      { paidTierAllowed: false, deps: { fetchImpl } },
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skips the paid call for a clean, passive-only scan (no findings, no active probe)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await runDeepReview(
      [],
      { targetOrigin: 'https://app.example' },
      { paidTierAllowed: true, activeProbeRan: false, deps: { fetchImpl } },
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('runs on a clean scan when the active probe actually ran', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [
              { type: 'text', text: JSON.stringify({ summary: 'Reviewed.', findings: [] }) },
            ],
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const result = await runDeepReview(
      [],
      { targetOrigin: 'https://app.example' },
      { paidTierAllowed: true, activeProbeRan: true, deps: { fetchImpl } },
    );
    expect(result?.summary).toBe('Reviewed.');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('isDeepReviewWorthwhile gates on findings or an active probe', () => {
    expect(isDeepReviewWorthwhile(0, false)).toBe(false);
    expect(isDeepReviewWorthwhile(1, false)).toBe(true);
    expect(isDeepReviewWorthwhile(0, true)).toBe(true);
  });

  it('returns null when ANTHROPIC_API_KEY is unset', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const result = await runDeepReview(
      [{ ruleId: 'x', severity: 'error', message: 'm' }],
      { targetOrigin: 'https://app.example' },
      { paidTierAllowed: true },
    );
    expect(result).toBeNull();
  });

  it('parses a deep-review JSON response with MODELS.deep', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  summary: 'Your customer table is world-readable.',
                  findings: [
                    {
                      title: 'Open customers table',
                      risk: 'Anyone can read emails.',
                      recommendation: 'Enable RLS.',
                    },
                  ],
                }),
              },
            ],
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;

    const result = await runDeepReview(
      [{ ruleId: 'runtime-supabase-rls-open', severity: 'error', message: 'open customers' }],
      { targetOrigin: 'https://app.example', contextSnippet: 'from("customers")' },
      { paidTierAllowed: true, deps: { fetchImpl } },
    );

    expect(result?.summary).toContain('world-readable');
    expect(result?.findings[0]?.title).toBe('Open customers table');
    const body = JSON.parse(String(vi.mocked(fetchImpl).mock.calls[0]?.[1]?.body)) as {
      model: string;
      messages: Array<{ content: string }>;
    };
    expect(body.model).toBe(MODELS.deep);
    expect(body.messages[0]?.content).toContain('<untrusted_scanned_content>');
  });
});
