'use client';

import { useEffect, useEffectEvent, useState, type ReactElement } from 'react';
import { AssurlyLogo } from './icons/AssurlyLogo';

interface DashboardSplashProps {
  /** Called once the splash has finished and should be unmounted. */
  onDone: () => void;
  /** Total on-screen lifetime in milliseconds. Defaults to the product spec of 4s. */
  durationMs?: number;
}

/** The command that types out in the terminal, char by char. */
const COMMAND = 'assurly scan';

type SplashPhase = 'typing' | 'probing' | 'ready' | 'leaving';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Post-login splash: a Mac-style terminal types `assurly scan`, runs a probe
 * line, and lands on a green animated checkmark — a 4-second brand moment tuned
 * to the scanner product. Purely presentational; the parent owns when it mounts
 * (only right after sign-in) and unmounts it via `onDone`.
 */
export function DashboardSplash({ onDone, durationMs = 4000 }: DashboardSplashProps): ReactElement {
  const [typed, setTyped] = useState('');
  const [phase, setPhase] = useState<SplashPhase>('typing');
  const finishSplash = useEffectEvent(onDone);

  // Lock background scroll while the full-screen splash is mounted.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const reduced = prefersReducedMotion();
    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedule = (fn: () => void, delay: number): void => {
      timers.push(setTimeout(fn, delay));
    };

    // Fade-out begins shortly before unmount so the exit is never abrupt.
    const leaveAt = Math.max(0, durationMs - 400);

    if (reduced) {
      // Honour reduced-motion: skip the typing/probe choreography and hold the
      // final frame for the same lifetime, so timing stays predictable.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time reduced-motion shortcut
      setTyped(COMMAND);
      setPhase('ready');
      schedule(() => setPhase('leaving'), leaveAt);
      schedule(() => finishSplash(), durationMs);
      return () => timers.forEach(clearTimeout);
    }

    const typeStartAt = 700;
    const perCharMs = 85;

    for (let index = 1; index <= COMMAND.length; index += 1) {
      schedule(() => setTyped(COMMAND.slice(0, index)), typeStartAt + index * perCharMs);
    }
    const typingDoneAt = typeStartAt + COMMAND.length * perCharMs;

    schedule(() => setPhase('probing'), typingDoneAt + 250);
    schedule(() => setPhase('ready'), typingDoneAt + 780);
    schedule(() => setPhase('leaving'), leaveAt);
    schedule(() => finishSplash(), durationMs);

    return () => timers.forEach(clearTimeout);
  }, [durationMs]);

  const showCaret = phase === 'typing' || phase === 'probing';

  return (
    <div
      className={`dashboard-splash${phase === 'leaving' ? ' dashboard-splash--leaving' : ''}`}
      role="status"
      aria-label="Signing you in to Assurly"
      data-testid="dashboard-splash"
    >
      <div className="dashboard-splash__stage">
        <div className="dashboard-splash__brand">
          <AssurlyLogo className="dashboard-splash__logo" />
        </div>

        <div className="dashboard-splash__terminal">
          <div className="dashboard-splash__titlebar">
            <span className="dashboard-splash__dot dashboard-splash__dot--red" aria-hidden="true" />
            <span
              className="dashboard-splash__dot dashboard-splash__dot--amber"
              aria-hidden="true"
            />
            <span
              className="dashboard-splash__dot dashboard-splash__dot--green"
              aria-hidden="true"
            />
            <span className="dashboard-splash__title">assurly — ship gate</span>
          </div>

          <div className="dashboard-splash__body">
            <div className="dashboard-splash__line">
              <span className="dashboard-splash__prompt" aria-hidden="true">
                ➜
              </span>
              <span className="dashboard-splash__cwd" aria-hidden="true">
                ~/project
              </span>
              <span className="dashboard-splash__cmd">
                {typed}
                {showCaret ? <span className="dashboard-splash__caret" aria-hidden="true" /> : null}
              </span>
            </div>

            <div
              className={`dashboard-splash__out${
                phase === 'probing' || phase === 'ready' || phase === 'leaving'
                  ? ' dashboard-splash__out--visible'
                  : ''
              }`}
            >
              <span className="dashboard-splash__muted">Probing production surface…</span>
            </div>

            <div
              className={`dashboard-splash__out dashboard-splash__result${
                phase === 'ready' || phase === 'leaving' ? ' dashboard-splash__out--visible' : ''
              }`}
            >
              <svg
                className="dashboard-splash__check"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  className="dashboard-splash__check-ring"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  className="dashboard-splash__check-mark"
                  d="M7 12.5 10.5 16 17 8.5"
                  stroke="currentColor"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="dashboard-splash__result-text">Ready to ship</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
