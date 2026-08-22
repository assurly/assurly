'use client';

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  applyDocumentTheme,
  readStoredPreference,
  setThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from '../../utils/theme';

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  preference: 'system',
  resolved: 'dark',
  setPreference: () => undefined,
});

export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [resolved, setResolved] = useState<ResolvedTheme>('dark');

  useLayoutEffect(() => {
    const stored = readStoredPreference();
    const nextResolved = applyDocumentTheme(stored);
    /* eslint-disable react-hooks/set-state-in-effect -- hydrate from localStorage after mount */
    setPreferenceState(stored);
    setResolved(nextResolved);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useLayoutEffect(() => {
    if (preference !== 'system' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (): void => {
      setResolved(applyDocumentTheme('system'));
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference): void => {
    setPreferenceState(next);
    setResolved(setThemePreference(next));
  }, []);

  const value = useMemo(
    (): ThemeContextValue => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
