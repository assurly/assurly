'use client';

import Link from 'next/link';
import { useSyncExternalStore, type ReactElement } from 'react';
import { COOKIE_NOTICE_COPY } from '../../utils/cookieInventory';
import {
  persistCookieNoticeDismissed,
  readCookieNoticeDismissed,
} from '../../utils/cookieNoticeStorage';

// The dismissal flag lives in localStorage (an external store), so it is read via
// useSyncExternalStore rather than a mount effect that calls setState — that keeps
// SSR/hydration consistent (the server snapshot renders nothing, avoiding a flash)
// without the cascading-render pattern the React lint rule flags.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function dismissCookieNotice(): void {
  persistCookieNoticeDismissed();
  listeners.forEach((listener) => listener());
}

export function CookieNotice(): ReactElement | null {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => readCookieNoticeDismissed(),
    () => true, // server snapshot: render nothing during SSR/hydration
  );

  if (dismissed) {
    return null;
  }

  return (
    <aside
      className="cookie-notice"
      role="region"
      aria-label="Cookie transparency notice"
      data-testid="cookie-notice"
    >
      <div className="cookie-notice__inner">
        <div className="cookie-notice__copy">
          <p className="cookie-notice__title">{COOKIE_NOTICE_COPY.title}</p>
          <p className="cookie-notice__body">{COOKIE_NOTICE_COPY.body}</p>
        </div>
        <div className="cookie-notice__actions">
          <Link href="/privacy#cookies" className="cookie-notice__link">
            {COOKIE_NOTICE_COPY.detailsLabel}
          </Link>
          <button type="button" className="cookie-notice__dismiss" onClick={dismissCookieNotice}>
            {COOKIE_NOTICE_COPY.dismissLabel}
          </button>
        </div>
      </div>
    </aside>
  );
}
