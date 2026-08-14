import type { WebFinding } from '../../../../utils/browserScanner';
import { buildAiFixPrompt } from '../../../../utils/aiFixPrompt';
import type { AppliedManualFix } from './shipLoopTypes';

export interface ManualCheckerHandoffInput {
  remainingFindings: readonly WebFinding[];
  appliedFixes: readonly AppliedManualFix[];
  mode: 'project' | 'snippet';
}

/**
 * Agent-ready clipboard brief for Cursor / Claude after a Manual Checker scan.
 * Deterministic — no LLM call. Reuses buildAiFixPrompt for remaining findings.
 */
export function buildManualCheckerHandoffPrompt(input: ManualCheckerHandoffInput): string {
  const appliedLines =
    input.appliedFixes.length === 0
      ? ['- (none yet)']
      : input.appliedFixes.map((fix) => `- ${fix.afterSummary}`);

  const remainingBody = buildAiFixPrompt([...input.remainingFindings]);
  // Drop the generic "Assurly fix prompt" header — Manual Checker owns the preamble.
  const remainingSections = remainingBody.split('\n\n');
  const remainingWithoutHeader =
    remainingSections.length > 1 ? remainingSections.slice(1).join('\n\n') : remainingBody;

  const modeLine =
    input.mode === 'project'
      ? 'Context: local project workspace in Assurly Manual Checker (browser-only).'
      : 'Context: configuration snippet scan in Assurly Manual Checker (browser-only).';

  return [
    'Assurly Manual Checker — agent handoff',
    'Goal: READY TO SHIP (0 blockers). Re-scan in Assurly Manual Checker after edits.',
    modeLine,
    '',
    'Already fixed locally by Assurly:',
    ...appliedLines,
    '',
    'Remaining issues to fix:',
    input.remainingFindings.length === 0
      ? 'No remaining issues. Confirm READY TO SHIP in Assurly Manual Checker.'
      : remainingWithoutHeader,
  ].join('\n');
}
