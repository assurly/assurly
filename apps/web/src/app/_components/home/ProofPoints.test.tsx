// Runs in the default node environment on purpose: the section is rendered with
// renderToStaticMarkup, which needs no DOM, and under a browser-like environment
// `import.meta.url` becomes an http URL that readFileSync cannot resolve.
// (Do not add an environment docblock above — vitest matches the directive
// anywhere in the leading comments, including inside a sentence about it.)
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PROOF_POINTS, ProofPoints } from './ProofPoints';

function render(): string {
  return renderToStaticMarkup(<ProofPoints />);
}

function sourceOf(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

/** Rule areas actually registered in the CLI, read from the source of truth. */
function ruleAreaCount(): number {
  const source = sourceOf('../../../../../../packages/cli/src/rules/index.ts');
  const block = source.match(/allRules:\s*Rule\[\]\s*=\s*\[([\s\S]*?)\]/)?.[1];
  if (!block) throw new Error('Could not find allRules in the CLI source.');
  return block.split(',').filter((entry) => entry.trim().length > 0).length;
}

/** Tools actually registered by the MCP server, read from the source of truth. */
function mcpToolCount(): number {
  const source = sourceOf('../../../../../../packages/mcp-server/src/tools.ts');
  const block = source.match(/ASSURLY_MCP_TOOL_NAMES\s*=\s*\[([\s\S]*?)\]/)?.[1];
  if (!block) throw new Error('Could not find ASSURLY_MCP_TOOL_NAMES in the MCP server source.');
  return [...block.matchAll(/'([a-z_]+)'/g)].length;
}

describe('ProofPoints', () => {
  it('never reintroduces fabricated customer testimony', () => {
    const html = render();
    const source = sourceOf('./ProofPoints.tsx');

    // Annex I of Directive 2005/29/EC as amended by (EU) 2019/2161 lists invented
    // consumer reviews as unfair in all circumstances. This section previously
    // shipped six of them with a "Verified customer" badge. No disclaimer cures
    // that, so the guard is on the markup, not on the wording around it.
    expect(html).not.toMatch(/verified customer/i);
    expect(html).not.toMatch(/out of 5 stars/i);
    expect(html).not.toContain('testimonial');
    expect(source).not.toMatch(/verified:\s*true/);
    expect(source).not.toMatch(/rating:\s*5/);

    // The invented people, by name, so a copy-paste restore fails loudly.
    for (const invented of [
      'Marcus Klein',
      'Sarah Johnson',
      'David Rodriguez',
      'Priya Sharma',
      'Tom Wasilewski',
      'Emma Laurent',
    ]) {
      expect(html, `${invented} is a fabricated persona and must not return`).not.toContain(
        invented,
      );
    }
  });

  it('states the rule-area count the CLI actually registers', () => {
    const html = render();
    expect(html).toContain(`${ruleAreaCount()} rule areas`);
  });

  it('states the tool count the MCP server actually registers', () => {
    const html = render();
    expect(html).toContain(`${mcpToolCount()} MCP tools`);
  });

  it('keeps every claim checkable against a public source', () => {
    expect(PROOF_POINTS.length).toBeGreaterThanOrEqual(4);
    for (const point of PROOF_POINTS) {
      expect(point.href, `${point.id} has no destination to verify it`).toMatch(/^(https:\/\/|\/)/);
      expect(point.linkLabel.length, `${point.id} has no link label`).toBeGreaterThan(0);
    }
  });

  it('does not claim a certification Assurly does not hold', () => {
    const html = render();
    // The Trust page states plainly that neither is held. This section must not
    // drift into implying otherwise.
    expect(html).toContain('No SOC 2. No ISO 27001.');
    expect(html).not.toMatch(/SOC 2 (certified|compliant)/i);
    expect(html).not.toMatch(/ISO 27001 (certified|compliant)/i);
  });

  it('renders an accessible, keyboard-reachable list of claims', () => {
    const html = render();
    expect(html).toContain('aria-labelledby="proof-heading"');
    expect(html).toContain('role="list"');
    expect(html).toContain('role="listitem"');
    expect(html.match(/role="listitem"/g)?.length).toBe(PROOF_POINTS.length);
  });
});
