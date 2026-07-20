import type { ReactElement } from 'react';
import { AssurlyMark } from '../../../_components/AssurlyMark';

interface AssurlyLogoProps {
  className?: string;
}

export function AssurlyLogo({ className }: AssurlyLogoProps): ReactElement {
  return (
    <span className={['assurly-logo', className].filter(Boolean).join(' ')}>
      <AssurlyMark className="assurly-logo__mark" />
      <span className="assurly-logo__text">
        Ass<span className="assurly-logo__accent">url</span>y
      </span>
    </span>
  );
}
