import type { WebFinding } from './browserScanner';

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
    'Add .github/workflows/shipready.yml using the ShipReady CI workflow template.',
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

function findingSortKey(finding: WebFinding): string {
  return [
    finding.file ?? '',
    String(finding.line ?? 0).padStart(8, '0'),
    finding.ruleId ?? '',
    finding.message ?? '',
  ].join('\0');
}

function formatFindingBlock(finding: WebFinding): string {
  const file = finding.file ?? 'unknown';
  const line = finding.line ?? 0;
  const problem = maskSecrets(finding.message);
  const instruction = deriveInstruction(finding);
  return `File ${file}, line ${line}: ${problem} → ${instruction}`;
}

export function buildAiFixPrompt(findings: WebFinding[]): string {
  if (findings.length === 0) {
    return [
      'ShipReady fix prompt',
      '',
      'No issues to fix.',
      'The scan passed with no findings that need remediation.',
    ].join('\n');
  }

  const ordered = [...findings].sort((left, right) =>
    findingSortKey(left).localeCompare(findingSortKey(right)),
  );

  const header = [
    'ShipReady fix prompt',
    '',
    'Apply the following deterministic fixes in order. Do not delete unrelated code.',
    `Findings: ${ordered.length}`,
  ].join('\n');

  return [header, ...ordered.map(formatFindingBlock)].join('\n\n');
}
