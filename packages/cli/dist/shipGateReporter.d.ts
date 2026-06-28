import { type ShipGateReport } from '@shipready/scanner-core';
import type { Finding } from './types';
export declare function buildCliShipGateReport(findings: Finding[], scannedFileCount: number): ShipGateReport;
export declare function printShipGateSummary(report: ShipGateReport): void;
