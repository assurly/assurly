import type { WebFinding } from '../browserScanner';
import { buildAiFixPrompt } from '../aiFixPrompt';
import { getCuratedConsequence } from '../consequenceMap';
import {
  AiUnavailableError,
  asUntrustedData,
  assertAiBudget,
  callClaude,
  MODELS,
  recordAiUsage,
  type ClaudeClientDeps,
} from './claudeClient';

export interface ContextualFixExplanation {
  /** Plain-language "why this matters" — curated consequence or AI. */
  whyItMatters: string;
  /** Deterministic Assurly fix prompt (never AI-authored SQL/code). */
  fixPrompt: string;
  whySource: 'curated' | 'ai' | 'message';
}

export interface GetContextualFixOptions {
  organizationId?: string;
  useAi?: boolean;
  deps?: ClaudeClientDeps;
}

const WHY_SYSTEM =
  'Explain in ONE short sentence why this security finding matters to a non-technical founder ' +
  '(money, customer data, or reputation). No jargon. No preamble. Return only the sentence.';

/**
 * Per-finding "why this matters / fix it for me" helper for auto-fix and copy-prompt
 * surfaces. The fix prompt itself stays deterministic (`buildAiFixPrompt`); only the
 * "why" line may use AI, and it degrades to curated consequence / message.
 */
export async function getContextualFixExplanation(
  finding: WebFinding,
  options: GetContextualFixOptions = {},
): Promise<ContextualFixExplanation> {
  const fixPrompt = buildAiFixPrompt([finding]);
  const curated = finding.ruleId ? getCuratedConsequence(finding.ruleId) : undefined;

  if (curated) {
    return {
      whyItMatters: curated.consequence,
      fixPrompt,
      whySource: 'curated',
    };
  }

  if (options.useAi !== false) {
    try {
      if (options.organizationId) assertAiBudget(options.organizationId);
      const text = await callClaude(
        {
          model: MODELS.fast,
          system: WHY_SYSTEM,
          messages: [
            {
              role: 'user',
              content: `Finding (rule "${finding.ruleId ?? 'unknown'}"):\n${asUntrustedData(finding.message)}`,
            },
          ],
          maxTokens: 100,
        },
        options.deps,
      );
      const trimmed = text.trim();
      if (trimmed) {
        if (options.organizationId)
          recordAiUsage(options.organizationId, Math.ceil(trimmed.length / 4) + 80);
        return { whyItMatters: trimmed, fixPrompt, whySource: 'ai' };
      }
    } catch (error) {
      if (!(error instanceof AiUnavailableError)) {
        console.warn('[Assurly] contextual fix AI failed:', (error as Error).message);
      }
    }
  }

  return {
    whyItMatters: finding.message,
    fixPrompt,
    whySource: 'message',
  };
}
