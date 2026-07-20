import type { ReactElement } from 'react';

interface AssurlyMarkProps {
  className?: string;
}

// The single source of the Assurly mark: an "A" whose crossbar is a GATE — a threshold
// the letter passes through — echoing the pre-deploy ship gate. The slot is punched with
// a mask so it is a true gap, and the stroke is `currentColor` so the mark takes on
// whatever colour its context sets. Shared by the dashboard logo and every site header.
//
// The mask id is stable and identical across instances: SSR-safe (deterministic) and
// correct even if two marks share a page, since the mask content never differs.
const GATE_MASK_ID = 'assurly-mark-gate';

export function AssurlyMark({ className }: AssurlyMarkProps): ReactElement {
  return (
    <svg
      className={className}
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <mask id={GATE_MASK_ID} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" />
        <rect x="5.6" y="12.35" width="12.8" height="1.7" rx="0.4" fill="black" />
      </mask>
      <polyline
        points="7,17.8 12,5.6 17,17.8"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        mask={`url(#${GATE_MASK_ID})`}
      />
    </svg>
  );
}
