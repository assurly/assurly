import type { ScannerFinding } from './index';
export interface AiAppSecurityScanResult {
    errorCount: number;
    warningCount: number;
    findings: ScannerFinding[];
}
type ScanResult = AiAppSecurityScanResult;
export declare function scanAiLlmKeyLeak(content: string, file?: string): ScanResult;
export declare function scanAiRouteAuthz(content: string, file?: string): ScanResult;
export declare function scanAiRateLimit(content: string, file?: string): ScanResult;
export declare function scanAiPromptInjection(content: string, file?: string): ScanResult;
export declare function scanAiPiiToModelContext(content: string, file?: string): ScanResult;
export declare function scanAiAppSecurity(content: string, file?: string): ScanResult;
export {};
