'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';

interface CopyButtonProps {
  /** Text written to the clipboard. */
  value: string;
  /** Idle label. */
  label?: string;
  /** Label shown briefly after a successful copy. */
  copiedLabel?: string;
}

const COPIED_RESET_MS = 2000;

/**
 * Secondary copy-to-clipboard control for Ship Gate actions ("Copy fix",
 * "Copy command"). Intentionally outline-styled so it never competes with the
 * primary "Run secure scan" CTA. Confirms with a soft "Copied!" state.
 * Clipboard access can be denied (insecure context or blocked permission); on
 * failure the label is left unchanged.
 */
export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied!',
}: CopyButtonProps): ReactElement {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  };

  return (
    <button
      type="button"
      className={`ship-gate-action-copy ship-gate-action-copy--secondary${
        copied ? ' ship-gate-action-copy--copied' : ''
      }`}
      data-cta="secondary"
      onClick={() => void handleCopy()}
      aria-label={copied ? copiedLabel : label}
    >
      <span aria-live="polite">{copied ? `✓ ${copiedLabel}` : label}</span>
    </button>
  );
}
