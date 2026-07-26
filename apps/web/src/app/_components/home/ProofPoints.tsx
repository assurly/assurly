import React from 'react';

/**
 * Replaces the former Testimonials section.
 *
 * That section carried six invented people — full names, job titles, companies,
 * five-star ratings and a "Verified customer" badge — for a product that has
 * never had a customer. Annex I of Directive 2005/29/EC, as amended by Directive
 * (EU) 2019/2161, lists presenting fabricated consumer reviews as a practice
 * that is unfair in all circumstances: there is no balancing test to pass and no
 * disclaimer that cures it. For a security product it is also self-defeating —
 * a tool that fakes its own evidence has no standing to audit anyone else's.
 *
 * A pre-launch product has no testimony. What it does have is claims a reader
 * can check in under a minute, which is what this section offers instead. Every
 * entry here must stay verifiable from a public source; anything that cannot be
 * checked does not belong on this page.
 *
 * The counts are guarded by ProofPoints.test.tsx, which derives them from the
 * package sources rather than trusting the literals below.
 */

/** Rule areas in packages/cli/src/rules/index.ts (`allRules`). */
const RULE_AREA_COUNT = 12;

/** Tools in packages/mcp-server/src/tools.ts (`ASSURLY_MCP_TOOL_NAMES`). */
const MCP_TOOL_COUNT = 5;

interface ProofPoint {
  id: string;
  claim: string;
  detail: string;
  href: string;
  linkLabel: string;
  external?: boolean;
}

export const PROOF_POINTS: ProofPoint[] = [
  {
    id: 'rules',
    claim: `${RULE_AREA_COUNT} rule areas`,
    detail:
      'Supabase row-level security, Stripe webhook signatures, secrets in client bundles, React Server Component leaks, migration safety, connection pooling, edge compatibility, cold starts, and the agent tooling itself.',
    href: 'https://www.npmjs.com/package/assurly',
    linkLabel: 'Read the rule list',
    external: true,
  },
  {
    id: 'packages',
    claim: 'Three packages on npm',
    detail:
      'assurly, @assurly/scanner-core and @assurly/mcp-server are published and installable right now. Run the scanner against your own repository before you create an account.',
    href: 'https://www.npmjs.com/package/assurly',
    linkLabel: 'View on npm',
    external: true,
  },
  {
    id: 'mcp',
    claim: `${MCP_TOOL_COUNT} MCP tools`,
    detail:
      'Cursor, Claude Code, VS Code and Windsurf can call Assurly as a ship gate before they deploy. A blocked verdict is returned as an error, so the agent stops instead of shipping.',
    href: '/mcp',
    linkLabel: 'See the MCP server',
  },
  {
    id: 'local',
    claim: 'Your source stays on your machine',
    detail:
      'Local scans run entirely on your own hardware. The Trust page states exactly what is read, what is stored, and what never leaves your device.',
    href: '/trust',
    linkLabel: 'Read the Trust page',
  },
  {
    id: 'licence',
    claim: 'MIT licensed',
    detail:
      'The scanner and the MCP server are open source. Read the rules, disagree with one, and check what it actually does rather than taking our word for it.',
    href: 'https://www.npmjs.com/package/@assurly/scanner-core',
    linkLabel: 'Inspect the source',
    external: true,
  },
  {
    id: 'certifications',
    claim: 'No SOC 2. No ISO 27001.',
    detail:
      'Assurly holds neither, and says so on its own Trust page rather than implying otherwise. If a security vendor is vague about what it has been audited for, that is the answer.',
    href: '/trust',
    linkLabel: 'See what we do claim',
  },
];

function ProofCard({ point }: { point: ProofPoint }): React.ReactElement {
  const linkProps = point.external ? { rel: 'noopener noreferrer' } : {};

  return (
    <article className="proof-card" data-testid={`proof-${point.id}`}>
      <h3 className="proof-claim">{point.claim}</h3>
      <p className="proof-detail">{point.detail}</p>
      <a className="proof-link" href={point.href} {...linkProps}>
        {point.linkLabel}
        <span aria-hidden="true"> →</span>
      </a>
    </article>
  );
}

export function ProofPoints(): React.ReactElement {
  return (
    <section className="proof-section" aria-labelledby="proof-heading">
      <div className="proof-header">
        <h2 id="proof-heading">Built for teams shipping AI-generated code</h2>
        <p className="proof-subheading">
          The same production failures keep showing up — exposed Supabase RLS, unverified Stripe
          webhooks, secrets in client bundles. Assurly catches them before deploy.
        </p>
        <p className="proof-note">
          Assurly is new, so there are no customer quotes here. Everything below can be checked
          yourself in about a minute.
        </p>
      </div>

      <div className="proof-grid" role="list" aria-label="Verifiable claims about Assurly">
        {PROOF_POINTS.map((point) => (
          <div key={point.id} role="listitem">
            <ProofCard point={point} />
          </div>
        ))}
      </div>
    </section>
  );
}
