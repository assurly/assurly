import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSURLY_MCP_TOOL_NAMES } from './tools';

/**
 * The README is the npm package page — for most people it is the only Assurly
 * documentation they will ever read.
 *
 * It once listed three tools while the server registered four; `assurly_verdict`,
 * the tool that needs an API key and leads to a paid plan, was missing from both
 * the README and the website. Nothing failed, because nothing was checking. These
 * tests make that drift a build failure instead of a silent gap on npmjs.com.
 *
 * The equivalent guard for the website lives in
 * `apps/web/src/app/mcp/page.test.tsx`.
 */
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

const SPELLED_NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'] as const;

describe('README', () => {
  it('documents every tool the server registers', () => {
    for (const name of ASSURLY_MCP_TOOL_NAMES) {
      expect(readme, `README does not document \`${name}\``).toContain(name);
    }
  });

  it('states the correct tool count in the setup steps', () => {
    const expected = SPELLED_NUMBERS[ASSURLY_MCP_TOOL_NAMES.length];
    expect(expected, 'Tool count outgrew the spelled-number table.').toBeDefined();

    // A stale count tells the reader their install half-failed and sends them
    // troubleshooting a problem that does not exist.
    const claims = [...readme.matchAll(/confirm the (\w+) `assurly_\*` tools/g)].map(
      (match) => match[1],
    );
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      expect(claim).toBe(expected);
    }
  });

  it('does not claim every tool runs locally', () => {
    // `assurly_verdict` reads the hosted API. The README used to open with
    // "Everything runs locally over stdio", which stopped being true the moment
    // that tool shipped. Source code still never leaves the machine — that is the
    // claim worth making, and the one worth protecting.
    expect(readme).not.toMatch(/Everything runs locally/i);
    expect(readme).toContain('Your source code never leaves your machine');
  });
});
