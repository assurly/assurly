import type { ScannerFinding } from './index';
export interface StripeLifecycleScanResult {
    errorCount: number;
    warningCount: number;
    findings: ScannerFinding[];
}
type ScanResult = StripeLifecycleScanResult;
export declare function scanStripeWebhookIdempotency(content: string, file?: string): ScanResult;
export declare function scanStripeLiveKeyInDev(content: string, file?: string): ScanResult;
export declare function scanStripeMissingSubscriptionEvents(content: string, file?: string): ScanResult;
export declare function scanStripeLifecycle(content: string, file?: string): ScanResult;
export {};
