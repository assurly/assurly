import type { ProjectFile } from './useManualScan';

export type ManualFixKind = 'rls' | 'stripe' | 'env' | 'rsc';

export interface AppliedManualFix {
  id: string;
  kind: ManualFixKind;
  /** Short label for lists (e.g. "Row-Level Security"). */
  label: string;
  /** Plain-language risk before the fix. */
  beforeSummary: string;
  /** Plain-language remediation after the fix. */
  afterSummary: string;
  filePaths: string[];
  ruleId?: string;
  /** Table name, env var, or module specifier when known. */
  detail?: string;
}

export type ShipLoopSnippetMode = 'sql' | 'stripe' | 'env';

export type ShipLoopUndoEntry =
  | {
      mode: 'project';
      files: ProjectFile[];
      fixes: AppliedManualFix[];
    }
  | {
      mode: ShipLoopSnippetMode;
      content: {
        sql?: string;
        stripe?: string;
        envExample?: string;
        envCode?: string;
      };
      fixes: AppliedManualFix[];
    };

export interface ShipReceiptInput {
  status: 'ready' | 'blocked' | 'review' | 'empty';
  shipScore: number;
  blockerCount: number;
  warningCount: number;
  scannedFileCount: number;
  cleanFileCount: number;
  appliedFixCount: number;
  projectName: string;
  generatedAt: string;
}
