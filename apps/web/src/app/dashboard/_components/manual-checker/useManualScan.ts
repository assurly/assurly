import { useMemo } from 'react';
import {
  scanEnvVariables,
  scanRscDataLeaks,
  scanColdStart,
  scanSqlMigration,
  scanStripeWebhook,
  type ScanResult,
} from '../../../../utils/browserScanner';
import { scanProject } from './projectWorkspace';

export type ManualCheckerTab = 'sql' | 'stripe' | 'env' | 'project';
export interface ProjectFile {
  path: string;
  content: string;
}

interface ManualScanInput {
  activeTab: ManualCheckerTab;
  sqlContent: string;
  stripeContent: string;
  envExampleContent: string;
  envCodeContent: string;
  sqlFileName: string | null;
  stripeFileName: string | null;
  envExampleFileName: string | null;
  envCodeFileName: string | null;
  projectFiles: ProjectFile[];
}

export function useManualScan(input: ManualScanInput): ScanResult {
  return useMemo(() => {
    if (input.activeTab === 'sql') {
      return scanSqlMigration(input.sqlContent, input.sqlFileName ?? 'schema.sql');
    }
    if (input.activeTab === 'stripe') {
      const fileName = input.stripeFileName ?? 'route.ts';
      const findings = [
        ...scanStripeWebhook(input.stripeContent, fileName).findings,
        ...scanRscDataLeaks(input.stripeContent, fileName).findings,
        ...scanColdStart(input.stripeContent, fileName).findings,
      ];
      return {
        errorCount: findings.filter((finding) => finding.severity === 'error').length,
        warningCount: findings.filter((finding) => finding.severity === 'warning').length,
        findings,
      };
    }
    if (input.activeTab === 'env') {
      return scanEnvVariables(
        input.envExampleContent,
        input.envCodeContent,
        input.envExampleFileName ?? '.env.example',
        input.envCodeFileName ?? 'code.ts',
      );
    }
    return scanProject(input.projectFiles);
  }, [input]);
}
