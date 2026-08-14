import { getCuratedConsequence } from '../../../../utils/consequenceMap';
import type { ProjectAutoFixBatchResult } from './projectAutoFix';
import type { AppliedManualFix, ManualFixKind, ShipLoopUndoEntry } from './shipLoopTypes';

const KIND_LABEL: Record<ManualFixKind, string> = {
  rls: 'Row-Level Security',
  stripe: 'Stripe webhook signature',
  env: 'Environment documentation',
  rsc: 'Server import boundary',
};

const KIND_RULE_ID: Record<ManualFixKind, string> = {
  rls: 'supabase-rls',
  stripe: 'stripe-webhook-signature',
  env: 'undocumented-env',
  rsc: 'supabase-service-role-leak',
};

const FALLBACK_BEFORE: Record<ManualFixKind, string> = {
  rls: 'A table was created without Row-Level Security — customer data can stay exposed until it is locked down.',
  stripe: 'Anyone can send fake payment events to your app without Stripe signature verification.',
  env: 'A setting used in code is missing from .env.example, so deploy or teammates can omit it and break the app.',
  rsc: 'A server-only module was reachable from client code, which can leak credentials into the browser.',
};

let fixIdCounter = 0;

export function resetShipLoopFixIdCounterForTests(): void {
  fixIdCounter = 0;
}

function nextFixId(): string {
  fixIdCounter += 1;
  return `manual-fix-${fixIdCounter}`;
}

function beforeForKind(kind: ManualFixKind, ruleId?: string): string {
  const curated = getCuratedConsequence(ruleId ?? KIND_RULE_ID[kind]);
  return curated?.consequence ?? FALLBACK_BEFORE[kind];
}

function afterForKind(kind: ManualFixKind, detail?: string): string {
  switch (kind) {
    case 'rls':
      return detail
        ? `Assurly enabled Row-Level Security on ${detail}.`
        : 'Assurly enabled Row-Level Security on the affected table.';
    case 'stripe':
      return 'Assurly added Stripe signature verification.';
    case 'env':
      return detail
        ? `Assurly documented ${detail} in .env.example.`
        : 'Assurly documented the missing environment variable in .env.example.';
    case 'rsc':
      return detail
        ? `Assurly commented out the unsafe server import of '${detail}'.`
        : 'Assurly commented out the unsafe server import.';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function describeAppliedFix(input: {
  kind: ManualFixKind;
  ruleId?: string;
  detail?: string;
  filePaths: readonly string[];
  id?: string;
}): AppliedManualFix {
  return {
    id: input.id ?? nextFixId(),
    kind: input.kind,
    label: KIND_LABEL[input.kind],
    beforeSummary: beforeForKind(input.kind, input.ruleId),
    afterSummary: afterForKind(input.kind, input.detail),
    filePaths: [...input.filePaths],
    ruleId: input.ruleId ?? KIND_RULE_ID[input.kind],
    detail: input.detail,
  };
}

/**
 * Expands a Fix-all batch result into one What-changed card per logical kind applied.
 */
export function describeBatchAppliedFixes(
  result: ProjectAutoFixBatchResult,
  filePaths: readonly string[] = [],
): AppliedManualFix[] {
  const cards: AppliedManualFix[] = [];
  const paths = [...filePaths];

  if (result.rlsTablesFixed > 0) {
    cards.push(
      describeAppliedFix({
        kind: 'rls',
        filePaths: paths,
        detail: result.rlsTablesFixed === 1 ? undefined : `${result.rlsTablesFixed} tables`,
      }),
    );
  }
  if (result.stripeFilesFixed > 0) {
    cards.push(describeAppliedFix({ kind: 'stripe', filePaths: paths }));
  }
  if (result.envVarsAdded > 0) {
    cards.push(
      describeAppliedFix({
        kind: 'env',
        filePaths: paths,
        detail: result.envVarsAdded === 1 ? undefined : `${result.envVarsAdded} variables`,
      }),
    );
  }
  if (result.rscImportsFixed > 0) {
    cards.push(describeAppliedFix({ kind: 'rsc', filePaths: paths }));
  }

  return cards;
}

export function pushUndoEntry(
  stack: readonly ShipLoopUndoEntry[],
  entry: ShipLoopUndoEntry,
): ShipLoopUndoEntry[] {
  return [...stack, entry];
}

export function popUndoEntry(stack: readonly ShipLoopUndoEntry[]): {
  entry: ShipLoopUndoEntry | null;
  stack: ShipLoopUndoEntry[];
} {
  if (stack.length === 0) {
    return { entry: null, stack: [] };
  }
  const next = stack.slice(0, -1);
  return { entry: stack[stack.length - 1] ?? null, stack: next };
}

export function cloneProjectFilesForUndo(
  files: ReadonlyArray<{ path: string; content: string }>,
): Array<{ path: string; content: string }> {
  return files.map((file) => ({ path: file.path, content: file.content }));
}
