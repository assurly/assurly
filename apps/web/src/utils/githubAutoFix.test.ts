import { describe, expect, it } from 'vitest';
import { buildGitHubAutoFixBatch } from './githubAutoFix';

describe('buildGitHubAutoFixBatch', () => {
  it('combines multiple RLS fixes in the same SQL file', () => {
    const fix = buildGitHubAutoFixBatch([
      {
        file_path: 'database.sql',
        message:
          "Supabase table 'attempts' is created but Row-Level Security (RLS) is not enabled.",
      },
      {
        file_path: 'database.sql',
        message: "Supabase table 'config' is created but Row-Level Security (RLS) is not enabled.",
      },
    ]);

    expect(fix?.title).toBe('security(rls): enable row level security on 2 tables');
    expect(fix?.statement).toContain('ALTER TABLE "attempts" ENABLE ROW LEVEL SECURITY;');
    expect(fix?.statement).toContain('ALTER TABLE "config" ENABLE ROW LEVEL SECURITY;');
  });
});
