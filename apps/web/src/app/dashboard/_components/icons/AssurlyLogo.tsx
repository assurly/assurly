import type { ReactElement } from 'react';
import { AssurlyMark } from '../../../_components/AssurlyMark';
import { AssurlyWordmark } from '../../../_components/AssurlyWordmark';

interface AssurlyLogoProps {
  className?: string;
  /**
   * When true, the logo is purely visual (parent link/button already exposes
   * `aria-label="Assurly"`). When false, this root is named "Assurly" itself.
   */
  decorative?: boolean;
}

export function AssurlyLogo({ className, decorative = false }: AssurlyLogoProps): ReactElement {
  return (
    <span
      className={['assurly-logo', className].filter(Boolean).join(' ')}
      {...(decorative
        ? { 'aria-hidden': true as const }
        : { role: 'img' as const, 'aria-label': 'Assurly' })}
    >
      <AssurlyMark className="assurly-logo__mark" />
      <AssurlyWordmark className="assurly-logo__text" accentClassName="assurly-logo__accent" />
    </span>
  );
}
