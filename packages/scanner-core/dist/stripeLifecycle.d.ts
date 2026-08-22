import type { ScannerFinding, SourceInput } from './index';
export interface StripeLifecycleScanResult {
    errorCount: number;
    warningCount: number;
    findings: ScannerFinding[];
}
type ScanResult = StripeLifecycleScanResult;
export declare function scanStripeWebhookIdempotency(content: string, file?: string): ScanResult;
/**
 * Same rule as `scanStripeWebhookIdempotency`, but a handler that delegates to a
 * relative import (1–2 hops) inherits that module's idempotency signals.
 * Package imports (`stripe`, `@/…`) are not followed.
 */
export declare function scanStripeWebhookIdempotencyForProject(sources: readonly SourceInput[]): ScanResult;
export declare function scanStripeLiveKeyInDev(content: string, file?: string): ScanResult;
export declare function scanStripeMissingSubscriptionEvents(content: string, file?: string): ScanResult;
export declare function scanStripeLifecycle(content: string, file?: string): ScanResult;
export {};
