import { type ShipGateOptions, type ShipGateReport } from '@assurly/scanner-core';
import type { Finding } from './types';
export declare function buildCliShipGateReport(findings: Finding[], scannedFileCount: number, scanScope?: ShipGateOptions['scanScope']): ShipGateReport;
export declare function printShipGateSummary(report: ShipGateReport): void;
