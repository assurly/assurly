import {
  AiUnavailableError,
  asUntrustedData,
  assertAiBudget,
  callClaude,
  MODELS,
  type ClaudeClientDeps,
} from './ai/claudeClient';
import {
  CONSEQUENCE_MAP,
  getCuratedConsequence,
  type ConsequenceEntry,
  type ConsequenceFinding,
} from './consequenceMap';

/**
 * Translates a technical finding into a plain-language business consequence a
 * non-engineer feels — money, reputation, and regulation, never CVSS or jargon.
 *
 * Deterministic first (the curated map), AI fallback second, and the raw finding
 * message last — AI is never on the critical path (convention §2.5). The curated
 * map itself lives in `consequenceMap.ts` (pure, client-safe); this module adds
 * the server-only AI fallback.
 */
export { CONSEQUENCE_MAP, getCuratedConsequence };
export type { ConsequenceEntry, ConsequenceFinding };

export interface ConsequenceResult {
  text: string;
  regulation?: string;
  source: 'curated' | 'ai' | 'message';
}

export interface GetConsequenceOptions {
  /** When set, enforces the org's AI budget before an AI fallback call. */
  organizationId?: string;
  /** Set false to skip the AI fallback entirely (curated map or message only). */
  useAi?: boolean;
  deps?: ClaudeClientDeps;
}

const AI_SYSTEM_PROMPT =
  'You translate a software security or reliability finding into ONE short, plain-language sentence a non-technical founder understands. ' +
  'Focus on the real-world consequence in terms of money, customer data, or reputation. ' +
  'Do not use jargon, severity scores, or code terms. Do not add a preamble. Return only the sentence.';

/**
 * Resolves the consequence for a finding: curated entry first, then a cached AI
 * sentence for unknown rules, then the raw finding message. Never throws on AI
 * failure — it degrades to the message so scans always complete (convention §2.5).
 */
export async function getConsequence(
  finding: ConsequenceFinding,
  options: GetConsequenceOptions = {},
): Promise<ConsequenceResult> {
  const curated = getCuratedConsequence(finding.ruleId);
  if (curated) {
    return { text: curated.consequence, regulation: curated.regulation, source: 'curated' };
  }

  if (options.useAi !== false) {
    try {
      if (options.organizationId) assertAiBudget(options.organizationId);
      const text = await callClaude(
        {
          model: MODELS.fast,
          system: AI_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: `Finding (rule "${finding.ruleId}"):\n${asUntrustedData(finding.message)}`,
            },
          ],
          maxTokens: 120,
        },
        options.deps,
      );
      const trimmed = text.trim();
      if (trimmed) return { text: trimmed, source: 'ai' };
    } catch (error) {
      // AiUnavailableError (no key) is the common, expected path — degrade quietly.
      if (!(error instanceof AiUnavailableError)) {
        console.warn('[Assurly] consequence AI fallback failed:', (error as Error).message);
      }
    }
  }

  return { text: finding.message, source: 'message' };
}
