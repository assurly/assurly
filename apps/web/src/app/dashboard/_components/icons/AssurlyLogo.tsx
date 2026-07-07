import type { ReactElement } from 'react';

interface AssurlyLogoProps {
  className?: string;
}

export function AssurlyLogo({ className }: AssurlyLogoProps): ReactElement {
  return (
    <span className={['assurly-logo', className].filter(Boolean).join(' ')}>
      <svg
        className="assurly-logo__mark"
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
        <path
          d="M12 12 4 7.5M12 12l8-4.5M12 12v9"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
      </svg>
      <span className="assurly-logo__text">
        Assur<span className="assurly-logo__accent">ly</span>
      </span>
    </span>
  );
}
