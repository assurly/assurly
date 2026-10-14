import {
  buildShipGateReport,
  getFindingGroupKey,
  isIssueFinding,
  type ShipGateGroup,
} from '@assurly/scanner-core';
import type { WebFinding } from './browserScanner';
import { getCuratedConsequence } from './consequenceMap';

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-(?:ant-)?[A-Za-z0-9-]{8,}\b/g,
  /\bsk_live_[A-Za-z0-9]{10,}\b/g,
  /\bsk_test_[A-Za-z0-9]{10,}\b/g,
  /\b(?:OPENAI|ANTHROPIC)_API_KEY\s*=\s*[^\s'"]+/gi,
];

const RULE_INSTRUCTIONS: Record<string, string> = {
  'ai-llm-key-in-client':
    'Remove the LLM credential from client code and load it only in a server-only route or Server Action.',
  'ai-route-missing-authz':
    'Add an authentication or session guard before calling the model or executing tools.',
  'ai-missing-rate-limit':
    'Add per-user rate limiting and a spend/token budget on this chat route.',
  'ai-pii-to-model-context': 'Strip or pseudonymize PII before sending data to the model context.',
  'ai-prompt-injection-surface':
    'Keep user input out of system prompts; pass it as a separate user-role message after validation.',
  'undocumented-env':
    'Add the missing variable to the nearest .env.example with an empty placeholder value.',
  'github-actions-integration':
    'Add .github/workflows/assurly.yml using the Assurly CI workflow template.',
  'supabase-rls': 'Enable row-level security on the affected table and add policies for each role.',
  'stripe-webhook-signature':
    'Verify Stripe webhook payloads with stripe.webhooks.constructEvent before processing events.',
};

function maskSecrets(text: string): string {
  return SECRET_PATTERNS.reduce(
    (masked, pattern) => masked.replace(pattern, '[REDACTED_SECRET]'),
    text,
  );
}

function deriveInstruction(finding: WebFinding): string {
  if (finding.suggestion?.trim()) return maskSecrets(finding.suggestion.trim());
  const fromRule = finding.ruleId ? RULE_INSTRUCTIONS[finding.ruleId] : undefined;
  if (fromRule) return fromRule;
  return 'Review this finding and apply a safe, minimal fix.';
}

function deriveWhyItMatters(finding: WebFinding): string | undefined {
  if (!finding.ruleId) return undefined;
  return getCuratedConsequence(finding.ruleId)?.consequence;
}

export interface AiFixPromptContext {
  /** Repository the scan read, e.g. `tibco87/Attesta`. */
  repository?: string;
  /** Commit the scan read (any length; shortened to 7 characters). */
  commit?: string;
  /** What the scan could not check — the Ship Gate report's coverage notes. */
  notChecked?: readonly string[];
  /**
   * Closing rules and the `npx assurly scan` check. Off when another surface
   * writes its own preamble and closing (the Manual Checker handoff).
   */
  includeChecklist?: boolean;
}

const MAX_LOCATIONS = 5;

function locationSortKey(finding: WebFinding): string {
  return [
    finding.file ?? '',
    String(finding.line ?? 0).padStart(8, '0'),
    finding.ruleId ?? '',
    finding.message ?? '',
  ].join('\0');
}

function formatLocations(findings: readonly WebFinding[]): string {
  const places = [
    ...new Set(
      [...findings]
        .sort((left, right) => locationSortKey(left).localeCompare(locationSortKey(right)))
        .map((finding) =>
          finding.line
            ? `${finding.file ?? 'unknown'}:${finding.line}`
            : (finding.file ?? 'unknown'),
        ),
    ),
  ];
  const shown = places.slice(0, MAX_LOCATIONS).join(', ');
  const more = places.length - MAX_LOCATIONS;
  return more > 0 ? `${shown} and ${more} more` : shown;
}

function formatGroup(
  group: ShipGateGroup,
  tag: string,
  index: number,
  findings: readonly WebFinding[],
): string {
  const members = findings.filter((finding) => getFindingGroupKey(finding) === group.id);
  const sample = members[0];
  const instruction = sample ? deriveInstruction(sample) : 'Apply a safe, minimal fix.';
  const why = sample ? deriveWhyItMatters(sample) : undefined;
  return [
    `${index}. ${maskSecrets(group.label)} [${tag}]`,
    `   Where: ${formatLocations(members)}`,
    `   Problem: ${maskSecrets(sample?.message ?? group.sampleMessage)}`,
    `   Fix: ${instruction}`,
    ...(why ? [`   Why it matters: ${why}`] : []),
  ].join('\n');
}

/**
 * The prompt a vibecoder pastes into Cursor, Claude Code, Codex or Lovable.
 * Problems come in the order they block launch, grouped the way the Ship Gate
 * shows them; only problems in the app are included (see findingKind), and it
 * ends with the check that proves the work is done. Deterministic: no LLM call.
 */
export function buildAiFixPrompt(findings: WebFinding[], context: AiFixPromptContext = {}): string {
  const issues = findings.filter((finding) => isIssueFinding(finding));
  if (issues.length === 0) {
    return [
      'Assurly fix prompt',
      '',
      'No issues to fix.',
      'The scan passed with no findings that need remediation.',
    ].join('\n');
  }

  const report = buildShipGateReport(issues);
  const ordered: Array<[ShipGateGroup, string]> = [
    ...report.blockers.map((group): [ShipGateGroup, string] => [group, 'blocks launch']),
    ...report.reviews.map((group): [ShipGateGroup, string] => [group, 'check before launch']),
    ...report.warnings.map((group): [ShipGateGroup, string] => [group, 'fix before launch']),
  ];
  const count = ordered.length;
  const target = context.repository ? ` in ${context.repository}` : '';
  const source = context.commit ? ` in commit ${context.commit.slice(0, 7)}` : '';
  const header = [
    `Fix ${count === 1 ? 'this problem' : `these ${count} problems`}${target} before launch, in the order listed.`,
    `Found by Assurly${source}.`,
  ].join('\n');

  const blocks = ordered.map(([group, tag], index) => formatGroup(group, tag, index + 1, issues));
  if (context.includeChecklist === false) return [header, ...blocks].join('\n\n');

  const notChecked = context.notChecked ?? [];
  return [
    header,
    ...blocks,
    [
      'Rules',
      '- Change only the files named above, plus a dependency manifest if a fix needs a new package.',
      '- Keep existing behaviour and do not delete unrelated code.',
      '- If a fix needs a decision only I can make, stop and ask me.',
    ].join('\n'),
    ...(notChecked.length > 0
      ? [
          [
            'Not part of this task: Assurly could not check the following, so do not change it.',
            ...notChecked.map((note) => `- ${note}`),
          ].join('\n'),
        ]
      : []),
    [
      'Check your work',
      '  npx assurly scan',
      'Expected: none of the problems above is reported.',
    ].join('\n'),
  ].join('\n\n');
}
