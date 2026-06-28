'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactElement } from 'react';
import { COOKIE_NOTICE_COPY } from '../../utils/cookieInventory';
import {
  persistCookieNoticeDismissed,
  readCookieNoticeDismissed,
} from '../../utils/cookieNoticeStorage';

export function CookieNotice(): ReactElement | null {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(!readCookieNoticeDismissed());
  }, []);

  if (!visible) {
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
          <button
            type="button"
            className="cookie-notice__dismiss"
            onClick={() => {
              persistCookieNoticeDismissed();
              setVisible(false);
            }}
          >
            {COOKIE_NOTICE_COPY.dismissLabel}
          </button>
        </div>
      </div>
    </aside>
  );
}
