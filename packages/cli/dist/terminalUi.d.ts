/**
 * Terminal presentation primitives.
 *
 * Every function here is pure and takes its capabilities as an argument, so the whole
 * surface is unit-testable without touching `process` or a real TTY. Detection happens
 * once, at the edge, in `detectTerminalCapabilities`.
 *
 * The guiding rule: decoration must never cost legibility. A terminal that cannot render
 * box drawing gets clean ASCII, a pipe gets no escape codes it did not ask for, and CI
 * logs stay free of hyperlink sequences that some viewers print raw.
 */
export interface TerminalCapabilities {
    /** Whether ANSI colour is welcome. Chalk does its own detection; this mirrors it. */
    color: boolean;
    /** Whether box-drawing and block characters will render. */
    unicode: boolean;
    /** Whether OSC 8 hyperlinks are safe to emit. */
    hyperlinks: boolean;
    /** Usable line width, already clamped to something readable. */
    width: number;
}
export declare function detectTerminalCapabilities(env?: NodeJS.ProcessEnv, isTty?: boolean, columns?: number | undefined, platform?: string): TerminalCapabilities;
/**
 * Opening frame line with an inline title, e.g. `╭─ Ship Gate ─────────╮`.
 *
 * Only the top and bottom of the frame are drawn — never the sides. Side rails would have
 * to be padded to an exact column, and the status line contains emoji whose rendered width
 * varies by terminal, so the rails would drift out of alignment on someone's machine.
 */
export declare function frameTop(title: string, caps: TerminalCapabilities): string;
export declare function frameBottom(caps: TerminalCapabilities): string;
/**
 * A quiet progress meter for the Ship Score, e.g. `━━━━━━━━━───────`.
 * Score is clamped, so a malformed report can never produce a negative-length bar.
 */
export declare function scoreMeter(score: number, caps: TerminalCapabilities, width?: number): string;
/**
 * OSC 8 hyperlink, falling back to the bare text when the terminal is not known to
 * support it. Never emit the escape sequence speculatively: terminals that do not
 * understand it print the URL and the control bytes inline, which looks broken.
 */
export declare function hyperlink(text: string, url: string, caps: TerminalCapabilities): string;
