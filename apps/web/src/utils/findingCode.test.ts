import { describe, expect, it, vi } from 'vitest';
import { loadFindingCode, type FindingCodeInput } from './findingCode';

const COMMIT = 'b74c7bc0a5f1e2d3c4b5a6978877665544332211';
const REPO = 'tibco87/notes';

/** GitHub contents API keyed by `path@ref`; anything else is a 404. */
function github(files: Record<string, string>, status: Record<string, number> = {}) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(String(input));
    const path = decodeURIComponent(url.pathname.split('/contents/')[1] ?? '');
    const key = `${path}@${url.searchParams.get('ref')}`;
    if (status[key]) return new Response('{}', { status: status[key] });
    if (key in files) return new Response(files[key], { status: 200 });
    return new Response('{"message":"Not Found"}', { status: 404 });
  });
}

function input(overrides: Partial<FindingCodeInput> = {}): FindingCodeInput {
  return {
    repositoryName: REPO,
    commitSha: COMMIT,
    tokens: ['installation-token'],
    finding: {
      file_path: 'app/api/webhooks/stripe/route.ts',
      line_number: 6,
      message: 'Stripe webhook endpoint appears to lack signature verification.',
      rule_id: 'stripe-webhook-signature',
      severity: 'error',
    },
    ...overrides,
  };
}

const WEBHOOK = [
  "import Stripe from 'stripe'",
  '',
  "const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '')",
  '',
  '// Stripe calls this on every subscription change.',
  'export async function POST(request: Request): Promise<Response> {',
  '  const event = JSON.parse(await request.text())',
  "  return new Response('ok')",
  '}',
].join('\n');

describe('loadFindingCode', () => {
  it('reads the file at the scanned commit and highlights the finding line', async () => {
    const fetchImpl = github({ [`app/api/webhooks/stripe/route.ts@${COMMIT}`]: WEBHOOK });
    const code = await loadFindingCode(input({ fetchImpl }));

    expect(code).toMatchObject({
      available: true,
      file: 'app/api/webhooks/stripe/route.ts',
      commitSha: COMMIT,
      githubUrl: `https://github.com/${REPO}/blob/${COMMIT}/app/api/webhooks/stripe/route.ts#L6`,
      window: { startLine: 1, highlightLine: 6 },
      suggestedChange: null,
    });
    expect(code.available && code.window.lines[5]).toContain('export async function POST');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain(`ref=${COMMIT}`);
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer installation-token',
    });
  });

  it('falls back to the next token when the installation cannot see the repository', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return auth === 'Bearer user-token'
        ? new Response(WEBHOOK, { status: 200 })
        : new Response('{}', { status: 404 });
    });
    const code = await loadFindingCode(
      input({ tokens: ['installation-token', 'user-token'], fetchImpl }),
    );
    expect(code.available).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('masks credentials before a line leaves the server', async () => {
    const source = `const stripe = new Stripe('sk_live_${'a'.repeat(30)}')\nexport async function POST() {}`;
    const code = await loadFindingCode(
      input({
        finding: { ...input().finding, line_number: 2 },
        fetchImpl: github({ [`app/api/webhooks/stripe/route.ts@${COMMIT}`]: source }),
      }),
    );
    expect(code.available && code.window.lines.join('\n')).not.toContain('a'.repeat(30));
    expect(code.available && code.window.redactedCount).toBe(1);
  });

  it('never fetches an env file, even when a finding points at one', async () => {
    const fetchImpl = github({});
    const code = await loadFindingCode(
      input({
        finding: { ...input().finding, file_path: '.env.local', line_number: 2 },
        fetchImpl,
      }),
    );
    expect(code).toMatchObject({ available: false, reason: 'sensitive_file' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['a scan without a commit', { commitSha: 'unknown' }, 'no_commit'],
    [
      'a project-wide finding',
      { finding: { ...input().finding, file_path: 'unknown' } },
      'not_located',
    ],
    [
      'a path that escapes the repository',
      { finding: { ...input().finding, file_path: '../etc/passwd' } },
      'not_located',
    ],
  ] as const)('explains %s instead of fetching', async (_label, overrides, reason) => {
    const fetchImpl = github({});
    expect(await loadFindingCode(input({ ...overrides, fetchImpl }))).toMatchObject({
      available: false,
      reason,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('says the file is gone when GitHub has no such file at that commit', async () => {
    const code = await loadFindingCode(input({ fetchImpl: github({}) }));
    expect(code).toMatchObject({ available: false, reason: 'file_missing' });
    expect(code.githubUrl).toContain(COMMIT);
  });

  it('says GitHub is unreachable rather than calling the file missing', async () => {
    const fetchImpl = github({}, { [`app/api/webhooks/stripe/route.ts@${COMMIT}`]: 503 });
    expect(await loadFindingCode(input({ fetchImpl }))).toMatchObject({
      available: false,
      reason: 'repository_unreachable',
    });
  });

  it('refuses binary content', async () => {
    const fetchImpl = github({ [`app/api/webhooks/stripe/route.ts@${COMMIT}`]: 'PK\u0000\u0003' });
    expect(await loadFindingCode(input({ fetchImpl }))).toMatchObject({ reason: 'binary' });
  });

  it('shows the RLS fix as a new migration beside the one it secures', async () => {
    const migration = '-- notes\n\ncreate table public.notes (\n  id uuid primary key\n);\n';
    const code = await loadFindingCode(
      input({
        finding: {
          file_path: 'supabase/migrations/0001_notes.sql',
          line_number: 3,
          message:
            "Supabase table 'notes' is created in migration files, but Row-Level Security (RLS) is not enabled.",
          rule_id: 'supabase-security-checks',
          severity: 'error',
        },
        fetchImpl: github({ [`supabase/migrations/0001_notes.sql@${COMMIT}`]: migration }),
      }),
    );

    expect(code.available && code.window.highlightLine).toBe(3);
    const change = code.available ? code.suggestedChange : null;
    expect(change).toMatchObject({
      file: 'supabase/migrations/99999999999999_assurly_enable_rls.sql',
      isNewFile: true,
    });
    expect(change?.lines.every((line) => line.kind === 'add')).toBe(true);
    expect(change?.lines.map((line) => line.text)).toContain(
      'ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;',
    );
  });

  it('shows the env fix as one line appended to the existing .env.example', async () => {
    const code = await loadFindingCode(
      input({
        finding: {
          file_path: 'app/api/chat/route.ts',
          line_number: 2,
          message:
            "Environment variable 'process.env.CHAT_MODEL_ID' is used but not documented in '.env.example'.",
          rule_id: 'undocumented-env',
          severity: 'warning',
        },
        fetchImpl: github({
          [`app/api/chat/route.ts@${COMMIT}`]: 'export const a = 1\nprocess.env.CHAT_MODEL_ID\n',
          [`.env.example@${COMMIT}`]: 'AI_GATEWAY_API_KEY=\n',
        }),
      }),
    );
    expect(code.available && code.suggestedChange).toMatchObject({
      file: '.env.example',
      isNewFile: false,
      lines: [
        { kind: 'context', text: 'AI_GATEWAY_API_KEY=' },
        { kind: 'add', text: 'CHAT_MODEL_ID=' },
      ],
    });
  });

  it('offers no RLS fix for a MySQL schema, as the pull request would refuse it', async () => {
    const mysql = 'CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB;\n';
    const code = await loadFindingCode(
      input({
        finding: {
          file_path: 'db/schema.sql',
          line_number: 1,
          message:
            "Supabase table 'users' is created in migration files, but Row-Level Security (RLS) is not enabled.",
          rule_id: 'supabase-security-checks',
          severity: 'error',
        },
        fetchImpl: github({ [`db/schema.sql@${COMMIT}`]: mysql }),
      }),
    );
    expect(code.available && code.suggestedChange).toBeNull();
  });
});
