import type { ScannerFinding, SourceInput } from './index';
export interface SupabasePoliciesScanResult {
    errorCount: number;
    warningCount: number;
    findings: ScannerFinding[];
}
type ScanResult = SupabasePoliciesScanResult;
export declare function scanSupabasePolicies(content: string, file?: string): ScanResult;
export declare function scanSupabaseStorage(content: string, file?: string): ScanResult;
export declare function scanAuthLinkedMigrationNoRls(sources: readonly SourceInput[]): ScanResult;
export declare function scanSupabaseDeepPolicies(sources: readonly SourceInput[]): ScanResult;
export {};
