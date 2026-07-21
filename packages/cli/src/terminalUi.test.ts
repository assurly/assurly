import { describe, expect, it } from 'vitest';
import {
  detectTerminalCapabilities,
  frameBottom,
  frameTop,
  hyperlink,
  scoreMeter,
  type TerminalCapabilities,
} from './terminalUi';

const rich: TerminalCapabilities = { color: true, unicode: true, hyperlinks: true, width: 60 };
const plain: TerminalCapabilities = { color: false, unicode: false, hyperlinks: false, width: 60 };

describe('detectTerminalCapabilities', () => {
  it('honours NO_COLOR even on a TTY', () => {
    expect(detectTerminalCapabilities({ NO_COLOR: '1' }, true, 100, 'darwin').color).toBe(false);
  });

  it('treats TERM=dumb as no colour, no unicode, no links', () => {
    const caps = detectTerminalCapabilities({ TERM: 'dumb' }, true, 100, 'darwin');
    expect(caps).toMatchObject({ color: false, unicode: false, hyperlinks: false });
  });

  it('drops colour when output is piped, unless forced', () => {
    expect(detectTerminalCapabilities({}, false, 100, 'darwin').color).toBe(false);
    expect(detectTerminalCapabilities({ FORCE_COLOR: '1' }, false, 100, 'darwin').color).toBe(true);
  });

  it('falls back to ASCII on legacy Windows consoles but not modern ones', () => {
    expect(detectTerminalCapabilities({}, true, 100, 'win32').unicode).toBe(false);
    expect(detectTerminalCapabilities({ WT_SESSION: 'x' }, true, 100, 'win32').unicode).toBe(true);
  });

  it('falls back to ASCII when the locale is explicitly not UTF-8', () => {
    expect(detectTerminalCapabilities({ LANG: 'C' }, true, 100, 'linux').unicode).toBe(false);
    expect(detectTerminalCapabilities({ LANG: 'en_US.UTF-8' }, true, 100, 'linux').unicode).toBe(
      true,
    );
  });

  /**
   * Hyperlinks are the easiest thing to get wrong: a terminal that does not understand
   * OSC 8 prints the control bytes and the URL inline, so they are emitted only for
   * terminals known to handle them — never in CI, never when piped.
   */
  it('emits hyperlinks only for known terminals, interactively', () => {
    const on = (env: NodeJS.ProcessEnv) => detectTerminalCapabilities(env, true, 100, 'darwin');
    expect(on({ TERM_PROGRAM: 'iTerm.app' }).hyperlinks).toBe(true);
    expect(on({ WT_SESSION: 'x' }).hyperlinks).toBe(true);
    expect(on({ VTE_VERSION: '6003' }).hyperlinks).toBe(true);
    expect(on({ VTE_VERSION: '4000' }).hyperlinks).toBe(false);
    expect(on({ TERM_PROGRAM: 'Apple_Terminal' }).hyperlinks).toBe(false);
    expect(on({}).hyperlinks).toBe(false);
    // Known-good terminal, but a build log — still off.
    expect(on({ TERM_PROGRAM: 'iTerm.app', CI: 'true' }).hyperlinks).toBe(false);
    expect(
      detectTerminalCapabilities({ TERM_PROGRAM: 'iTerm.app' }, false, 100, 'darwin').hyperlinks,
    ).toBe(false);
  });

  it('clamps width so output stays readable in tiny and enormous terminals', () => {
    expect(detectTerminalCapabilities({}, true, 10, 'darwin').width).toBe(44);
    expect(detectTerminalCapabilities({}, true, 400, 'darwin').width).toBe(88);
    expect(detectTerminalCapabilities({}, true, undefined, 'darwin').width).toBe(80);
  });
});

describe('frame', () => {
  it('draws a titled rule that is exactly the terminal width', () => {
    const top = frameTop('Ship Gate', rich);
    expect(top).toHaveLength(rich.width);
    expect(top.startsWith('╭─ Ship Gate ')).toBe(true);
    expect(top.endsWith('╮')).toBe(true);
    expect(frameBottom(rich)).toHaveLength(rich.width);
  });

  it('uses ASCII when box drawing is unavailable', () => {
    expect(frameTop('Ship Gate', plain)).toMatch(/^\+- Ship Gate -+\+$/);
    expect(frameBottom(plain)).toMatch(/^\+-+\+$/);
  });

  it('never produces a negative-length rule when the title outgrows the width', () => {
    const narrow: TerminalCapabilities = { ...rich, width: 44 };
    expect(() => frameTop('x'.repeat(200), narrow)).not.toThrow();
  });
});

describe('scoreMeter', () => {
  it('fills in proportion to the score', () => {
    expect(scoreMeter(0, rich, 10)).toBe('─'.repeat(10));
    expect(scoreMeter(100, rich, 10)).toBe('━'.repeat(10));
    expect(scoreMeter(50, rich, 10)).toBe('━'.repeat(5) + '─'.repeat(5));
  });

  it('keeps a constant width and clamps impossible scores', () => {
    for (const score of [-40, 0, 72, 100, 250, Number.NaN]) {
      expect(scoreMeter(score, rich, 20)).toHaveLength(20);
    }
  });

  it('degrades to ASCII', () => {
    expect(scoreMeter(50, plain, 10)).toBe('=====-----');
  });
});

describe('hyperlink', () => {
  const ESC = '\u001B';
  const BEL = '\u0007';

  it('wraps text in OSC 8 when supported', () => {
    expect(hyperlink('assurly.dev', 'https://assurly.dev', rich)).toBe(
      `${ESC}]8;;https://assurly.dev${BEL}assurly.dev${ESC}]8;;${BEL}`,
    );
  });

  it('returns bare text with no control bytes when unsupported', () => {
    const out = hyperlink('assurly.dev', 'https://assurly.dev', plain);
    expect(out).toBe('assurly.dev');
    expect(out).not.toContain(ESC);
    expect(out).not.toContain(BEL);
  });
});
