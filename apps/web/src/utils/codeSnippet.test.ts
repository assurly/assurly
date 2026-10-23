import { describe, expect, it } from 'vitest';
import {
  buildCodeWindow,
  isSensitiveSourcePath,
  MAX_SNIPPET_LINE_CHARS,
  redactSecrets,
  singleHunkDiff,
  SNIPPET_RADIUS,
} from './codeSnippet';

const numbered = (count: number): string =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n');

describe('isSensitiveSourcePath', () => {
  it.each([
    '.env',
    '.env.local',
    'apps/web/.env.production',
    'config/.env.development.local',
    'certs/server.pem',
    'deploy/id_rsa',
    'keys/signing.key',
    'secrets/service-account.p12',
  ])('never shows %s', (path) => {
    expect(isSensitiveSourcePath(path)).toBe(true);
  });

  it.each(['.env.example', 'apps/web/.env.sample', '.env.template', 'app/api/route.ts'])(
    'shows %s',
    (path) => {
      expect(isSensitiveSourcePath(path)).toBe(false);
    },
  );
});

describe('redactSecrets', () => {
  it('hides provider keys but keeps the prefix that says what they are', () => {
    const { lines, redactedCount } = redactSecrets(
      [
        `const stripe = new Stripe('sk_live_${'a'.repeat(24)}')`,
        `const openai = 'sk-proj-${'b'.repeat(40)}'`,
        `const gh = 'ghp_${'c'.repeat(36)}'`,
        `aws_access_key_id = AKIA${'D'.repeat(16)}`,
        `const hook = 'whsec_${'e'.repeat(24)}'`,
      ].join('\n'),
    );
    expect(lines.join('\n')).not.toMatch(/a{24}|b{40}|c{36}|D{16}|e{24}/);
    expect(lines[0]).toContain('sk_live_');
    expect(lines[1]).toContain('sk-proj-');
    expect(redactedCount).toBe(5);
  });

  it('hides a Supabase service-role JWT and a password inside a connection string', () => {
    const jwt = `eyJhbGciOiJIUzI1NiJ9.${'x'.repeat(40)}.${'y'.repeat(40)}`;
    const { lines } = redactSecrets(
      [`const key = '${jwt}'`, 'DATABASE_URL="postgres://app:hunter2hunter2@db:5432/app"'].join(
        '\n',
      ),
    );
    expect(lines[0]).not.toContain('x'.repeat(40));
    expect(lines[1]).toContain('postgres://app:');
    expect(lines[1]).not.toContain('hunter2');
  });

  it('hides string literals assigned to secret-looking names', () => {
    const { lines } = redactSecrets(
      [
        "const WEBHOOK_SECRET = 'not-a-known-format-123'",
        '  apiKey: "plain-value-456",',
        'password: `correct-horse-battery`',
      ].join('\n'),
    );
    expect(lines.join('\n')).not.toMatch(/not-a-known-format|plain-value|correct-horse/);
  });

  it('leaves code that only reads a secret from the environment untouched', () => {
    const code = [
      "const secret = process.env.STRIPE_WEBHOOK_SECRET ?? ''",
      'const key = process.env.SUPABASE_SERVICE_ROLE_KEY',
      'export const maxDuration = 30',
    ].join('\n');
    expect(redactSecrets(code)).toEqual({ lines: code.split('\n'), redactedCount: 0 });
  });

  it('hides every line of a private key block, including a window that starts inside it', () => {
    const content = [
      'const key = `',
      '-----BEGIN PRIVATE KEY-----',
      'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC',
      'BKcwggSjAgEAAoIBAQC7',
      '-----END PRIVATE KEY-----',
      '`',
    ].join('\n');
    const { lines } = redactSecrets(content);
    expect(lines.join('\n')).not.toMatch(/MIIEvQ|BKcwgg/);
    expect(lines[1]).toContain('BEGIN PRIVATE KEY');
    expect(lines[4]).toContain('END PRIVATE KEY');
  });

  it('hides a private key written on one line with escaped newlines', () => {
    const { lines } = redactSecrets(
      'const pem = "-----BEGIN RSA PRIVATE KEY-----\\nMIIBOgIBAAJBAKj34\\n-----END RSA PRIVATE KEY-----"',
    );
    expect(lines[0]).not.toContain('MIIBOgIBAAJBAKj34');
  });
});

describe('redactSecrets on hostile input', () => {
  // Every line of a fetched file goes through these patterns, minified bundles
  // included. Two of them once took 23 s and 33 s on these inputs.
  it.each([
    ['one long identifier full of keywords', 'secret'.repeat(50_000)],
    ['a long dotted line that looks like a URL scheme', `eyJ${'a.'.repeat(100_000)}`],
  ])('stays linear on %s', (_label, input) => {
    const startedAt = performance.now();
    redactSecrets(input);
    expect(performance.now() - startedAt).toBeLessThan(1500);
  });
});

describe('buildCodeWindow', () => {
  it(`shows ${SNIPPET_RADIUS} lines either side of the finding`, () => {
    const window = buildCodeWindow(numbered(40), 20);
    expect(window.startLine).toBe(20 - SNIPPET_RADIUS);
    expect(window.lines).toHaveLength(SNIPPET_RADIUS * 2 + 1);
    expect(window.lines[SNIPPET_RADIUS]).toBe('line 20');
    expect(window.highlightLine).toBe(20);
  });

  it('clamps the window at the start and end of a file', () => {
    expect(buildCodeWindow(numbered(40), 2)).toMatchObject({ startLine: 1, highlightLine: 2 });
    const end = buildCodeWindow(numbered(40), 40);
    expect(end.lines.at(-1)).toBe('line 40');
    expect(end.highlightLine).toBe(40);
  });

  it('shows the top of the file with no highlight when the finding has no line', () => {
    const window = buildCodeWindow(numbered(40), undefined);
    expect(window).toMatchObject({ startLine: 1, highlightLine: null });
    expect(window.lines[0]).toBe('line 1');
  });

  it('does not highlight a line the file no longer has', () => {
    const window = buildCodeWindow(numbered(5), 90);
    expect(window.highlightLine).toBeNull();
    expect(window.lines.at(-1)).toBe('line 5');
  });

  it('reads CRLF files and truncates minified lines', () => {
    const window = buildCodeWindow(`a\r\n${'x'.repeat(5000)}\r\nc`, 2);
    expect(window.lines[0]).toBe('a');
    expect(window.lines[1].length).toBeLessThanOrEqual(MAX_SNIPPET_LINE_CHARS + 1);
    expect(window.lines[1].endsWith('…')).toBe(true);
  });

  it('redacts before it slices, so the window cannot leak a key block it starts inside', () => {
    const content = [
      '-----BEGIN PRIVATE KEY-----',
      ...Array.from({ length: 12 }, () => 'SECRETBODYLINE'),
      '-----END PRIVATE KEY-----',
    ].join('\n');
    const window = buildCodeWindow(content, 12);
    expect(window.lines.join('\n')).not.toContain('SECRETBODYLINE');
    expect(window.redactedCount).toBeGreaterThan(0);
  });
});

describe('singleHunkDiff', () => {
  it('shows an appended statement with the lines it follows as context', () => {
    const before = 'A=\nB=\nC=\nD=\n';
    const after = 'A=\nB=\nC=\nD=\nE=\n';
    expect(singleHunkDiff(before, after, 2)).toEqual([
      { kind: 'context', text: 'C=', oldLine: 3, newLine: 3 },
      { kind: 'context', text: 'D=', oldLine: 4, newLine: 4 },
      { kind: 'add', text: 'E=', newLine: 5 },
    ]);
  });

  it('shows a new file as additions only', () => {
    expect(singleHunkDiff('', 'one\ntwo\n')).toEqual([
      { kind: 'add', text: 'one', newLine: 1 },
      { kind: 'add', text: 'two', newLine: 2 },
    ]);
  });

  it('shows a replaced line as a removal and an addition', () => {
    expect(singleHunkDiff('X=1\nY=old\nZ=3', 'X=1\nY=new\nZ=3', 1)).toEqual([
      { kind: 'context', text: 'X=1', oldLine: 1, newLine: 1 },
      { kind: 'remove', text: 'Y=old', oldLine: 2 },
      { kind: 'add', text: 'Y=new', newLine: 2 },
      { kind: 'context', text: 'Z=3', oldLine: 3, newLine: 3 },
    ]);
  });

  it('returns nothing when the content did not change', () => {
    expect(singleHunkDiff('same\n', 'same\n')).toEqual([]);
  });
});
