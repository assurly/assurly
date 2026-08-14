import type { AssurlyScanReportJson } from './scanReportJson';
export interface SubmitScanOptions {
    apiKey: string;
    apiBaseUrl: string;
    repo: string;
    report: AssurlyScanReportJson;
    commitSha?: string;
    branch?: string;
    fetchImpl?: typeof fetch;
}
export declare function submitScanReport(options: SubmitScanOptions): Promise<{
    id: string;
    shipScore: number;
    verdict: string;
}>;
