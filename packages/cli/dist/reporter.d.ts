import { Finding } from './types';
import { type TerminalCapabilities } from './terminalUi';
/**
 * Renders the scan results in a clean, color-coded, professional console layout.
 */
export declare function reportFindings(findings: Finding[], caps?: TerminalCapabilities): void;
