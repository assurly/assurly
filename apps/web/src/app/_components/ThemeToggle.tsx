'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import type { ReactElement } from 'react';
import { THEME_PREFERENCES, type ThemePreference } from '../../utils/theme';
import { useTheme } from './ThemeProvider';

const OPTION_META: Record<ThemePreference, { label: string; Icon: typeof Monitor }> = {
  system: { label: 'System', Icon: Monitor },
  light: { label: 'Light', Icon: Sun },
  dark: { label: 'Dark', Icon: Moon },
};

interface ThemeToggleProps {
  /** `header` is the icon pill (chrome + overlays); `sheet` paints visible labels. */
  variant?: 'header' | 'sheet';
}

function joinClasses(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function ThemeToggle({ variant = 'header' }: ThemeToggleProps): ReactElement {
  const { preference, setPreference } = useTheme();

  return (
    <div className={joinClasses('theme-toggle', `theme-toggle--${variant}`)}>
      <p className="theme-toggle__eyebrow" aria-hidden="true">
        Appearance
      </p>
      <div className="theme-toggle__group" role="group" aria-label="Color theme">
        {THEME_PREFERENCES.map((option) => {
          const { label, Icon } = OPTION_META[option];
          const selected = preference === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              aria-label={label}
              className={joinClasses('theme-toggle__btn', selected && 'theme-toggle__btn--active')}
              onClick={() => setPreference(option)}
            >
              <Icon aria-hidden="true" className="theme-toggle__icon" strokeWidth={1.75} />
              <span
                className={joinClasses(
                  'theme-toggle__label',
                  variant === 'header' && 'visually-hidden',
                )}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
