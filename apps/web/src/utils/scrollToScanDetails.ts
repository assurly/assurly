export const SCAN_DETAILS_CONTAINER_ID = 'scan-details-container';
export const REPO_SCAN_CARD_ID = 'repo-scan-card';
export const REPO_SCAN_WORKSPACE_ID = 'repo-scan-workspace';

const FALLBACK_HEADER_PX = 80;
const SCROLL_GAP_PX = 16;

const DEFAULT_SCROLL: ScrollIntoViewOptions = { behavior: 'instant', block: 'start' };

function stickyChromeBottom(element: Element | null, headerBottom: number): number {
  if (!element) return headerBottom;
  const style = getComputedStyle(element);
  if (style.position !== 'sticky' && style.position !== 'fixed') return headerBottom;
  const height = element.getBoundingClientRect().height;
  const stickyTop = Number.parseFloat(style.top);
  const topConstraint = Number.isFinite(stickyTop) ? stickyTop : headerBottom;
  return Math.max(headerBottom, topConstraint + height);
}

/** Sticky dashboard chrome that would otherwise cover a `block: start` scroll target. */
export function dashboardChromeOffsetPx(): number {
  if (typeof document === 'undefined') {
    return FALLBACK_HEADER_PX + SCROLL_GAP_PX;
  }

  const chrome = document.querySelector('.dashboard-chrome');
  if (chrome) {
    const chromeBottom = chrome.getBoundingClientRect().bottom;
    const selected = document.querySelector('.selected-repo-header');
    return Math.round(stickyChromeBottom(selected, chromeBottom) + SCROLL_GAP_PX);
  }

  const header = document.querySelector('.dashboard-header');
  const headerRect = header?.getBoundingClientRect();
  const headerBottom = headerRect?.bottom ?? headerRect?.height ?? FALLBACK_HEADER_PX;
  const tabs = document.querySelector('.dashboard-tabs');
  const afterTabs = stickyChromeBottom(tabs, headerBottom);
  const selected = document.querySelector('.selected-repo-header');
  return Math.round(stickyChromeBottom(selected, afterTabs) + SCROLL_GAP_PX);
}

function invokeWindowScrollTo(options: ScrollToOptions): void {
  if (typeof window.scrollTo !== 'function') {
    return;
  }
  const isMock = 'mock' in window.scrollTo;
  const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
  if (isJsdom && !isMock) {
    return;
  }
  window.scrollTo(options);
}

/** Keep keyboard focus on the destination so the jump control cannot steal the scroll. */
function moveFocusWithoutScrolling(target: HTMLElement): void {
  if (!target.hasAttribute('tabindex')) {
    target.tabIndex = -1;
  }
  target.focus({ preventScroll: true });
}

export function scrollDashboardElement(
  target: HTMLElement,
  _options: ScrollIntoViewOptions = DEFAULT_SCROLL,
): void {
  if (typeof window === 'undefined') {
    return;
  }
  moveFocusWithoutScrolling(target);
  const top = window.scrollY + target.getBoundingClientRect().top - dashboardChromeOffsetPx();
  // `auto` inherits `html { scroll-behavior: smooth }` and gets cancelled by
  // focus restoration. `instant` is the only value that jumps reliably.
  invokeWindowScrollTo({ top: Math.max(0, top), behavior: 'instant' });
}

export function scrollDashboardAnchor(
  elementId: string,
  options: ScrollIntoViewOptions = DEFAULT_SCROLL,
): boolean {
  const target = document.getElementById(elementId);
  if (!target) {
    return false;
  }
  scrollDashboardElement(target, options);
  return true;
}

export function scrollToScanDetails(options: ScrollIntoViewOptions = DEFAULT_SCROLL): boolean {
  // Prefer the outer scan card so Jump lands on history + Ship Gate as one
  // complete surface, not the inner beige panel with the card header clipped.
  if (scrollDashboardAnchor(REPO_SCAN_CARD_ID, options)) {
    return true;
  }
  return scrollDashboardAnchor(SCAN_DETAILS_CONTAINER_ID, options);
}

export function scrollToRepoWorkspace(options: ScrollIntoViewOptions = DEFAULT_SCROLL): boolean {
  return scrollDashboardAnchor(REPO_SCAN_WORKSPACE_ID, options);
}
