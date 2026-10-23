import type { Node } from '@babel/types';
import type { ScannerFinding } from './index';
export interface AuthBoundaryScanResult {
    errorCount: number;
    warningCount: number;
    findings: ScannerFinding[];
}
type AstNode = Node & Record<string, unknown>;
type ScanResult = AuthBoundaryScanResult;
/**
 * Line of the first exported HTTP handler (`export async function POST`, or a
 * Pages Router `export default` handler), so findings point at the entry point.
 */
export declare function handlerExportLine(ast: AstNode): number;
/** {@link handlerExportLine} for raw source; line 1 when the file does not parse. */
export declare function handlerLineOf(content: string): number;
export declare function scanServerActionAuth(content: string, file?: string): ScanResult;
export declare function scanRouteHandlerAuth(content: string, file?: string): ScanResult;
export declare function scanServiceRoleBypass(content: string, file?: string): ScanResult;
export declare function scanAuthBoundary(content: string, file?: string): ScanResult;
export {};
