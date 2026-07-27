import { Finding } from './types';
import { type TerminalCapabilities } from './terminalUi';
/**
 * Describes the surface a focused scan actually covered, so a clean result can
 * be stated without implying the whole project was examined.
 */
export interface ScanSurface {
    /** Human-readable name of the surface, e.g. "install-time trust". */
    label: string;
    /** The flag that produced it, e.g. "--supply". */
    flag: string;
}
/**
 * Renders the scan results in a clean, color-coded, professional console layout.
 *
 * `surface` is set only for focused scans (`--agent`, `--supply`). A focused run
 * examines one narrow surface, so it must never claim the project is production
 * ready: the same project can be clean under `--supply` and blocked under a full
 * scan. Overstating the scope of a clean result is the exact failure this tool
 * exists to prevent, so the wording is scoped rather than absolute.
 */
export declare function reportFindings(findings: Finding[], caps?: TerminalCapabilities, surface?: ScanSurface): void;
