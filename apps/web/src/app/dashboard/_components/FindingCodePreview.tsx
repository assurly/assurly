'use client';

import { useEffect, useRef, useState, type ReactElement, type SyntheticEvent } from 'react';
import { clientApi, type FindingCodeResult } from '../../../utils/clientApi';

type LoadedCode = Extract<FindingCodeResult, { available: true }>;
type SuggestedChange = NonNullable<LoadedCode['suggestedChange']>;

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; code: FindingCodeResult }
  | { status: 'failed' };

const DIFF_MARKERS = { context: ' ', remove: '−', add: '+' } as const;

function GitHubLink({ href }: { href: string }): ReactElement {
  return (
    <a className="finding-code__github" href={href} target="_blank" rel="noopener noreferrer">
      Open on GitHub <span aria-hidden="true">↗</span>
    </a>
  );
}

function CodeWindow({ code }: { code: LoadedCode }): ReactElement {
  const { startLine, lines, highlightLine, redactedCount } = code.window;
  return (
    <>
      <div className="finding-code__meta">
        <span className="finding-code__file">{code.file}</span>
        <span className="finding-code__commit">
          at <code>{code.commitSha.slice(0, 7)}</code>
        </span>
        <GitHubLink href={code.githubUrl} />
      </div>
      <pre className="finding-code__block" tabIndex={0} aria-label={`Lines from ${code.file}`}>
        <code>
          {lines.map((text, index) => {
            const lineNumber = startLine + index;
            const isFindingLine = lineNumber === highlightLine;
            return (
              <span
                key={lineNumber}
                className={`finding-code__line${isFindingLine ? ' finding-code__line--hit' : ''}`}
                aria-current={isFindingLine ? 'true' : undefined}
                data-testid={`finding-code-line-${lineNumber}`}
              >
                <span className="finding-code__number" aria-hidden="true">
                  {lineNumber}
                </span>
                <span className="finding-code__text">{text || ' '}</span>
              </span>
            );
          })}
        </code>
      </pre>
      {redactedCount > 0 ? (
        <p className="finding-code__note">
          {redactedCount === 1 ? '1 credential hidden.' : `${redactedCount} credentials hidden.`}{' '}
          Assurly never shows secret values, even to you.
        </p>
      ) : null}
    </>
  );
}

function ChangeDiff({ change }: { change: SuggestedChange }): ReactElement {
  return (
    <section className="finding-code__change" aria-label="What the fix changes">
      <h4 className="finding-code__change-title">What the fix changes</h4>
      <p className="finding-code__change-file">
        {change.file}
        {change.isNewFile ? <span className="finding-code__new-file"> (new file)</span> : null}
      </p>
      <pre className="finding-code__block finding-code__block--diff" tabIndex={0}>
        <code>
          {change.lines.map((line, index) => (
            <span
              key={index}
              className={`finding-code__line finding-code__line--${line.kind}`}
              data-kind={line.kind}
            >
              <span className="finding-code__number" aria-hidden="true">
                {line.kind === 'remove' ? line.oldLine : line.newLine}
              </span>
              <span className="finding-code__marker" aria-hidden="true">
                {DIFF_MARKERS[line.kind]}
              </span>
              <span className="finding-code__text">{line.text || ' '}</span>
            </span>
          ))}
        </code>
      </pre>
    </section>
  );
}

/**
 * The lines behind a finding, read from GitHub only when the reader opens it,
 * and the change Assurly's fix would make. Nothing is fetched for a closed card.
 */
export function FindingCodePreview({ findingId }: { findingId: string }): ReactElement {
  const [state, setState] = useState<PreviewState>({ status: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const load = async (): Promise<void> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: 'loading' });
    try {
      const code = await clientApi.findingCode(findingId, controller.signal);
      if (!controller.signal.aborted) setState({ status: 'ready', code });
    } catch {
      if (!controller.signal.aborted) setState({ status: 'failed' });
    }
  };

  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>): void => {
    if (event.currentTarget.open && state.status === 'idle') void load();
  };

  return (
    <details
      className="finding-code"
      onToggle={handleToggle}
      data-testid={`finding-code-${findingId}`}
    >
      <summary>Show the code</summary>
      <div className="finding-code__body" aria-live="polite" aria-busy={state.status === 'loading'}>
        {state.status === 'loading' ? (
          <p className="finding-code__note">Reading the file from GitHub…</p>
        ) : null}
        {state.status === 'failed' ? (
          <div role="alert" className="finding-code__error">
            Could not load the code.{' '}
            <button type="button" className="finding-code__retry" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : null}
        {state.status === 'ready' && !state.code.available ? (
          <p className="finding-code__note">
            {state.code.message}{' '}
            {state.code.githubUrl ? <GitHubLink href={state.code.githubUrl} /> : null}
          </p>
        ) : null}
        {state.status === 'ready' && state.code.available ? (
          <>
            <CodeWindow code={state.code} />
            {state.code.suggestedChange ? <ChangeDiff change={state.code.suggestedChange} /> : null}
          </>
        ) : null}
      </div>
    </details>
  );
}
