'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { copyToClipboard } from './copyToClipboard';

interface CodeBlockProps {
  code: string;
  label: string;
}

type CopyFeedback = 'idle' | 'copied' | 'failed';

const FEEDBACK_RESET_MS = 2000;
const COPY_FAILED_LABEL = 'Press ⌘C';

/**
 * A horizontally scrollable code block with a copy control.
 *
 * Config snippets and install commands must keep their exact characters, so they
 * scroll rather than wrap — but a scroll container that only responds to the
 * mouse strands keyboard users (WCAG 2.1.1). `role="region"` + `tabIndex` make it
 * focusable and scrollable with arrow keys, matching CookieInventoryTable.
 */
export function CodeBlock({ code, label }: CodeBlockProps): ReactElement {
  const [feedback, setFeedback] = useState<CopyFeedback>('idle');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const showFeedback = (next: CopyFeedback): void => {
    setFeedback(next);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setFeedback('idle'), FEEDBACK_RESET_MS);
  };

  const handleCopy = async (): Promise<void> => {
    const ok = await copyToClipboard(code);
    showFeedback(ok ? 'copied' : 'failed');
  };

  const buttonLabel =
    feedback === 'copied' ? 'Copied' : feedback === 'failed' ? COPY_FAILED_LABEL : 'Copy';
  const ariaLabel =
    feedback === 'copied'
      ? 'Copied'
      : feedback === 'failed'
        ? `${COPY_FAILED_LABEL} to copy ${label}`
        : `Copy ${label}`;
  const liveMessage =
    feedback === 'copied'
      ? 'Copied to clipboard'
      : feedback === 'failed'
        ? `Copy failed. ${COPY_FAILED_LABEL} to copy.`
        : '';

  return (
    <div className="code-block-wrap">
      <button
        type="button"
        className={`code-block-copy${
          feedback === 'copied'
            ? ' code-block-copy--copied'
            : feedback === 'failed'
              ? ' code-block-copy--failed'
              : ''
        }`}
        onClick={() => void handleCopy()}
        aria-label={ariaLabel}
      >
        {buttonLabel}
      </button>
      <span className="visually-hidden" aria-live="polite">
        {liveMessage}
      </span>
      <pre className="code-block" role="region" aria-label={label} tabIndex={0}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
