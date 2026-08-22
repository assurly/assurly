export const THEME_STORAGE_KEY = 'assurly-theme';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export type ResolvedTheme = 'light' | 'dark';

export const THEME_COLOR_HEX: Record<ResolvedTheme, string> = {
  dark: '#0A0A0B',
  light: '#F7F7FA',
};

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function resolveTheme(preference: ThemePreference, systemIsLight: boolean): ResolvedTheme {
  switch (preference) {
    case 'light':
      return 'light';
    case 'dark':
      return 'dark';
    case 'system':
      return systemIsLight ? 'light' : 'dark';
    default: {
      const exhaustive: never = preference;
      return exhaustive;
    }
  }
}

export function parseStoredPreference(raw: string | null): ThemePreference {
  return isThemePreference(raw) ? raw : 'system';
}

export function readStoredPreference(): ThemePreference {
  try {
    return parseStoredPreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function persistPreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Private mode / blocked storage — theme still applies for this session.
  }
}

export function systemPrefersLight(): boolean {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: light)').matches;
}

export function applyDocumentTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference, systemPrefersLight());
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;
  syncThemeColorMeta(resolved);
  return resolved;
}

export function syncThemeColorMeta(resolved: ResolvedTheme): void {
  const color = THEME_COLOR_HEX[resolved];
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  if (metas.length === 0) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = color;
    document.head.appendChild(meta);
    return;
  }
  for (const meta of metas) {
    meta.setAttribute('content', color);
    meta.removeAttribute('media');
  }
}

/**
 * Blocking bootstrap: runs before first paint so the first frame matches the
 * stored preference. Keep this self-contained — it cannot import runtime code.
 *
 * Allowed by CSP via `THEME_BOOTSTRAP_CSP_HASH` (not a nonce on the tag —
 * browsers strip nonce from the DOM and React would hydrate-mismatch).
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var stored=localStorage.getItem(k);var pref=stored==='light'||stored==='dark'||stored==='system'?stored:'system';var light=window.matchMedia('(prefers-color-scheme: light)').matches;var resolved=pref==='light'||(pref==='system'&&light)?'light':'dark';var r=document.documentElement;r.setAttribute('data-theme',resolved);r.setAttribute('data-theme-preference',pref);r.style.colorScheme=resolved;}catch(e){document.documentElement.setAttribute('data-theme','dark');document.documentElement.style.colorScheme='dark';}})();`;

/** `script-src` hash of `THEME_BOOTSTRAP_SCRIPT`. Keep in lockstep via theme.test.ts. */
export const THEME_BOOTSTRAP_CSP_HASH = 'sha256-IaMKRaFa00fkRtbmIMmUvQVEsWopRwDbaaGtzxcarYI=';

export function setThemePreference(preference: ThemePreference): ResolvedTheme {
  persistPreference(preference);
  return applyDocumentTheme(preference);
}
