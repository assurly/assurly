import type { ReactElement } from 'react';

interface AssurlyWordmarkProps {
  className?: string;
  /** Class on the accented middle letters (`url`). */
  accentClassName?: string;
}

/**
 * Visual Assurly wordmark with an accented "url" middle.
 * Always presentational — parents supply `aria-label="Assurly"` so screen
 * readers never announce the split as "Ass url y".
 */
export function AssurlyWordmark({
  className,
  accentClassName,
}: AssurlyWordmarkProps): ReactElement {
  return (
    <span className={className} aria-hidden="true">
      Ass<span className={accentClassName}>url</span>y
    </span>
  );
}
