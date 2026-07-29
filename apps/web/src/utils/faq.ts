import { MCP_TOOL_COUNT, RULE_AREA_COUNT } from './productFacts';

export interface FaqEntry {
  id: string;
  question: string;
  /** Plain text. Rendered as-is and emitted verbatim into FAQPage structured data. */
  answer: string;
}

/**
 * The published questions and answers.
 *
 * One source for both the section a visitor reads and the `FAQPage` structured
 * data a crawler parses. Google requires the two to match — markup describing
 * an answer the page does not show is a manual-action risk — and keeping them
 * in one array makes divergence impossible rather than merely discouraged.
 *
 * Two constraints shape the wording:
 *
 * 1. Each answer stands alone. A generative engine lifts a passage out of its
 *    page and quotes it without the surrounding context, so an answer that
 *    starts "It also checks…" is unusable to it. Every answer here names its own
 *    subject and leads with the direct answer before qualifying it.
 * 2. Every claim is checkable against something that ships. The counts come from
 *    the constants ProofPoints.test.tsx derives from the package sources, not
 *    from prose written once and left behind.
 */
export const FAQ_ENTRIES: FaqEntry[] = [
  {
    id: 'how-do-i-know',
    question: 'How do I know if my AI-generated app is safe to deploy?',
    answer:
      'Run a pre-deploy check that reads the project the way an attacker would, not the way the code reads. Assurly scans a Next.js, Supabase, Stripe and Vercel project across ' +
      `${RULE_AREA_COUNT} rule areas and returns a single verdict — READY TO SHIP, REVIEW RECOMMENDED, or NOT READY TO SHIP — with a Ship Score out of 100. ` +
      'AI coding tools produce working code quickly but routinely leave production wiring unfinished: a database table without row-level security, a payment webhook that never verifies its signature, a service key that reaches the browser. Those are the gaps the scan is built to find.',
  },
  {
    id: 'what-does-it-check',
    question: 'What does Assurly check before I ship?',
    answer:
      `Assurly checks ${RULE_AREA_COUNT} rule areas: Supabase row-level security and exposed service-role keys, Stripe webhook signature verification, secrets and undocumented environment variables reaching the client bundle, React Server Component data leaks, SQL and migration safety, serverless connection pooling, Vercel edge compatibility, cold-start cost, TypeScript strictness, missing CI checks, the AI agent's own tooling and MCP configuration, and install-time trust under npm 12. ` +
      'Each finding arrives with the exact fix — the SQL statement or the config change — rather than a warning to go research.',
  },
  {
    id: 'source-code-upload',
    question: 'Does Assurly upload my source code?',
    answer:
      'No. The Assurly CLI and the MCP server analyse your project entirely on your own machine and make no network calls while scanning. The manual web checker parses pasted snippets, folders and ZIP files inside your browser. Connected GitHub scans are the exception and are explicit: Assurly retrieves repository content server-side using a short-lived GitHub App token, stores findings, file paths and line numbers, and does not retain complete source files.',
  },
  {
    id: 'npm-install-scripts',
    question: 'Which of my dependencies can run code when I install them?',
    answer:
      'Run `npx assurly scan --supply` to list them. npm 12 stopped running install scripts by default, so every project now records which dependencies it trusts to execute code during installation in an `allowScripts` allowlist. A bare package name in that allowlist grants execution to every version of the package, forever — including a version published later by whoever takes the package over. An exact version pin does not. Assurly reads the allowlist, the lockfile install-script flags and non-registry dependencies, entirely offline.',
  },
  {
    id: 'agent-checks-itself',
    question: 'Can my AI coding agent run the check itself before deploying?',
    answer:
      `Yes. Assurly ships an MCP server with ${MCP_TOOL_COUNT} tools, so an agent in Cursor, Claude Code, VS Code or Windsurf can gate its own work. Install it with \`npx -y @assurly/mcp-server\`. ` +
      'When the verdict is blocked the tool returns an error rather than a passing result, which stops the agent instead of letting it ship. Assurly also audits the agent stack itself with `npx assurly scan --agent`, reporting MCP servers that run shell commands, remote endpoints on plain HTTP, credentials written into config, and instructions hidden from readers but visible to models.',
  },
  {
    id: 'ship-score',
    question: 'What is a Ship Score?',
    answer:
      'A Ship Score is a single number out of 100 summarising whether a project is ready for production, shown with one of three verdicts. Blockers are the findings that must be fixed before deploying and drive the verdict to NOT READY TO SHIP. Warnings are worth reviewing but do not block. The score exists so the decision to deploy is one answer rather than a list a non-specialist has to interpret.',
  },
  {
    id: 'ci-integration',
    question: 'Can Assurly run in CI and fail the build?',
    answer:
      'Yes. `npx assurly scan` exits with a non-zero status when the verdict is blocked, so it drops into any CI pipeline as an ordinary step with no plugin required. `assurly init` writes a GitHub Actions workflow for you. Because the CLI scans locally, CI needs no API key and no account.',
  },
  {
    id: 'free',
    question: 'Is Assurly free?',
    answer:
      'The CLI is free and unlimited: `npx assurly scan` runs the full gate locally with no account. The free hosted plan adds the live URL proof-probe, one guarded app and MCP server access. The Pro plan, at $19 per month, adds unlimited guarded apps, continuous monitoring on every deploy, AI deep review, auto-fix pull requests and private repository scanning.',
  },
];
