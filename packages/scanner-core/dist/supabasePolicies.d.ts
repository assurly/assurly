import type { ScannerFinding, SourceInput } from './index';
export interface SupabasePoliciesScanResult {
    errorCount: number;
    warningCount: number;
    findings: ScannerFinding[];
}
type ScanResult = SupabasePoliciesScanResult;
export declare function scanSupabasePolicies(content: string, file?: string): ScanResult;
export declare function scanSupabaseStorage(content: string, file?: string): ScanResult;
/**
 * Tables a migration enables RLS on, with the line of each ALTER TABLE — also
 * when the statement is formatted across lines (`alter table x` / `enable row
 * level security;`). Names come back raw; callers normalise them their way.
 */
export declare function rlsEnabledStatements(content: string): Array<{
    table: string;
    line: number;
}>;
export declare function scanAuthLinkedMigrationNoRls(sources: readonly SourceInput[]): ScanResult;
export declare function scanSupabaseDeepPolicies(sources: readonly SourceInput[]): ScanResult;
export {};
