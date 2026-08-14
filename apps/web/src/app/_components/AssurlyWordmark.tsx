import type { ReactElement } from 'react';

/** Default accent class — green "url" in Ass·url·y across every surface. */
export const ASSURLY_WORDMARK_ACCENT_CLASS = 'assurly-wordmark__accent';

interface AssurlyWordmarkProps {
  className?: string;
  /** Class on the accented middle letters (`url`). Defaults to the brand accent. */
  accentClassName?: string;
}

/**
 * Visual Assurly wordmark with an accented "url" middle.
 * Always presentational — parents supply `aria-label="Assurly"` so screen
 * readers never announce the split as "Ass url y".
 */
export function AssurlyWordmark({
  className,
  accentClassName = ASSURLY_WORDMARK_ACCENT_CLASS,
}: AssurlyWordmarkProps): ReactElement {
  return (
    <span className={className} aria-hidden="true">
      Ass<span className={accentClassName}>url</span>y
    </span>
  );
}
