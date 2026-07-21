"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectTerminalCapabilities = detectTerminalCapabilities;
exports.frameTop = frameTop;
exports.frameBottom = frameBottom;
exports.scoreMeter = scoreMeter;
exports.hyperlink = hyperlink;
/** Terminals known to render OSC 8 hyperlinks correctly. Allowlist, not guesswork. */
const HYPERLINK_TERM_PROGRAMS = new Set(['iTerm.app', 'WezTerm', 'Hyper', 'vscode', 'ghostty']);
const MIN_WIDTH = 44;
const MAX_WIDTH = 88;
function clampWidth(columns) {
    const raw = typeof columns === 'number' && Number.isFinite(columns) ? columns : 80;
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(raw)));
}
function supportsUnicode(env, platform) {
    if (env.TERM === 'dumb')
        return false;
    if (platform === 'win32') {
        // Only the modern Windows terminals are dependable; legacy conhost with a non-UTF-8
        // code page turns box drawing into mojibake.
        return Boolean(env.WT_SESSION || env.TERM_PROGRAM || env.ConEmuANSI === 'ON');
    }
    // Elsewhere assume UTF-8 unless the locale positively says otherwise. Being stricter
    // would drop to ASCII across most CI images, which do render UTF-8 fine.
    const locale = env.LC_ALL || env.LC_CTYPE || env.LANG;
    if (locale && !/utf-?8/i.test(locale))
        return false;
    return true;
}
function supportsHyperlinks(env, isTty) {
    // Not interactive, or a build log: a raw OSC 8 sequence is noise at best.
    if (!isTty || env.CI)
        return false;
    if (env.TERM === 'dumb')
        return false;
    if (env.TERM_PROGRAM && HYPERLINK_TERM_PROGRAMS.has(env.TERM_PROGRAM))
        return true;
    if (env.WT_SESSION || env.KITTY_WINDOW_ID)
        return true;
    const vte = Number.parseInt(env.VTE_VERSION ?? '', 10);
    if (Number.isFinite(vte) && vte >= 5000)
        return true;
    return false;
}
function detectTerminalCapabilities(env = process.env, isTty = Boolean(process.stdout.isTTY), columns = process.stdout.columns, platform = process.platform) {
    const color = !env.NO_COLOR && env.TERM !== 'dumb' && (isTty || Boolean(env.FORCE_COLOR));
    return {
        color,
        unicode: supportsUnicode(env, platform),
        hyperlinks: supportsHyperlinks(env, isTty),
        width: clampWidth(columns),
    };
}
const GLYPHS = {
    unicode: {
        topLeft: '╭',
        topRight: '╮',
        bottomLeft: '╰',
        bottomRight: '╯',
        horizontal: '─',
        meterFull: '━',
        meterEmpty: '─',
    },
    ascii: {
        topLeft: '+',
        topRight: '+',
        bottomLeft: '+',
        bottomRight: '+',
        horizontal: '-',
        meterFull: '=',
        meterEmpty: '-',
    },
};
function glyphs(caps) {
    return caps.unicode ? GLYPHS.unicode : GLYPHS.ascii;
}
/**
 * Opening frame line with an inline title, e.g. `╭─ Ship Gate ─────────╮`.
 *
 * Only the top and bottom of the frame are drawn — never the sides. Side rails would have
 * to be padded to an exact column, and the status line contains emoji whose rendered width
 * varies by terminal, so the rails would drift out of alignment on someone's machine.
 */
function frameTop(title, caps) {
    const g = glyphs(caps);
    const label = ` ${title} `;
    // corners + one leading dash + the label; the rest is filler.
    const filler = Math.max(0, caps.width - label.length - 3);
    return `${g.topLeft}${g.horizontal}${label}${g.horizontal.repeat(filler)}${g.topRight}`;
}
function frameBottom(caps) {
    const g = glyphs(caps);
    return `${g.bottomLeft}${g.horizontal.repeat(Math.max(0, caps.width - 2))}${g.bottomRight}`;
}
/**
 * A quiet progress meter for the Ship Score, e.g. `━━━━━━━━━───────`.
 * Score is clamped, so a malformed report can never produce a negative-length bar.
 */
function scoreMeter(score, caps, width = 28) {
    const g = glyphs(caps);
    const safeWidth = Math.max(4, Math.floor(width));
    const bounded = Math.max(0, Math.min(100, Number.isFinite(score) ? score : 0));
    const filled = Math.round((bounded / 100) * safeWidth);
    return g.meterFull.repeat(filled) + g.meterEmpty.repeat(safeWidth - filled);
}
/**
 * OSC 8 hyperlink, falling back to the bare text when the terminal is not known to
 * support it. Never emit the escape sequence speculatively: terminals that do not
 * understand it print the URL and the control bytes inline, which looks broken.
 */
function hyperlink(text, url, caps) {
    if (!caps.hyperlinks)
        return text;
    // OSC 8: ESC ] 8 ;; <url> BEL <text> ESC ] 8 ;; BEL. Written as explicit escapes so
    // the control bytes survive formatters, editors and copy-paste intact.
    const OSC = '\u001B]8;;';
    const BEL = '\u0007';
    return `${OSC}${url}${BEL}${text}${OSC}${BEL}`;
}
