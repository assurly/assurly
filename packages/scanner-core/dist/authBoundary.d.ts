import type { ScannerFinding } from './index';
export interface AuthBoundaryScanResult {
    errorCount: number;
    warningCount: number;
    findings: ScannerFinding[];
}
type ScanResult = AuthBoundaryScanResult;
export declare function scanServerActionAuth(content: string, file?: string): ScanResult;
export declare function scanRouteHandlerAuth(content: string, file?: string): ScanResult;
export declare function scanServiceRoleBypass(content: string, file?: string): ScanResult;
export declare function scanAuthBoundary(content: string, file?: string): ScanResult;
export {};
