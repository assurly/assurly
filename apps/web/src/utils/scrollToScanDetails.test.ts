// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REPO_SCAN_CARD_ID,
  SCAN_DETAILS_CONTAINER_ID,
  dashboardChromeOffsetPx,
  scrollToRepoWorkspace,
  scrollToScanDetails,
} from './scrollToScanDetails';

function mountHeader(height: number): HTMLElement {
  const header = document.createElement('header');
  header.className = 'dashboard-header';
  Object.defineProperty(header, 'getBoundingClientRect', {
    value: () => ({ height, top: 0, bottom: height, width: 800, left: 0, right: 800, x: 0, y: 0 }),
  });
  document.body.appendChild(header);
  return header;
}

function mountTarget(id: string, top: number): HTMLElement {
  const target = document.createElement('div');
  target.id = id;
  Object.defineProperty(target, 'getBoundingClientRect', {
    value: () => ({
      height: 400,
      top,
      bottom: top + 400,
      width: 800,
      left: 0,
      right: 800,
      x: 0,
      y: top,
    }),
  });
  document.body.appendChild(target);
  return target;
}

describe('scrollToScanDetails', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('returns false when the scan details container is missing', () => {
    expect(scrollToScanDetails()).toBe(false);
  });

  it('scrolls so the details sit below the sticky header', () => {
    mountHeader(79);
    mountTarget(SCAN_DETAILS_CONTAINER_ID, 800);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });

    expect(scrollToScanDetails({ behavior: 'smooth', block: 'start' })).toBe(true);
    expect(dashboardChromeOffsetPx()).toBe(95);
    expect(scrollTo).toHaveBeenCalledWith({ top: 705, behavior: 'instant' });
    const target = document.getElementById(SCAN_DETAILS_CONTAINER_ID);
    expect(target?.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(target);
  });

  it('prefers the repository scan card so Jump starts at history, not mid-panel', () => {
    mountHeader(79);
    mountTarget(REPO_SCAN_CARD_ID, 500);
    mountTarget(SCAN_DETAILS_CONTAINER_ID, 800);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });

    expect(scrollToScanDetails()).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 405, behavior: 'instant' });
    expect(document.activeElement).toBe(document.getElementById(REPO_SCAN_CARD_ID));
  });

  it('uses the unified dashboard chrome height for the scroll offset', () => {
    const chrome = document.createElement('div');
    chrome.className = 'dashboard-chrome';
    Object.defineProperty(chrome, 'getBoundingClientRect', {
      value: () => ({
        height: 136,
        top: 0,
        bottom: 136,
        width: 800,
        left: 0,
        right: 800,
        x: 0,
        y: 0,
      }),
    });
    document.body.appendChild(chrome);

    expect(dashboardChromeOffsetPx()).toBe(152);
  });

  it('includes sticky dashboard tabs in the scroll offset', () => {
    mountHeader(80);
    const tabs = document.createElement('div');
    tabs.className = 'dashboard-tabs';
    Object.defineProperty(tabs, 'getBoundingClientRect', {
      value: () => ({
        height: 56,
        top: 80,
        bottom: 136,
        width: 800,
        left: 0,
        right: 800,
        x: 0,
        y: 80,
      }),
    });
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      if (element === tabs) {
        return { position: 'sticky', top: '80px' } as CSSStyleDeclaration;
      }
      return { position: 'static', top: 'auto' } as CSSStyleDeclaration;
    });
    document.body.appendChild(tabs);

    expect(dashboardChromeOffsetPx()).toBe(152);
  });

  it('uses the sticky top constraint when it sits below the header', () => {
    mountHeader(77);
    const selected = document.createElement('section');
    selected.className = 'selected-repo-header';
    Object.defineProperty(selected, 'getBoundingClientRect', {
      value: () => ({
        height: 77,
        top: 120,
        bottom: 197,
        width: 375,
        left: 0,
        right: 375,
        x: 0,
        y: 120,
      }),
    });
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      if (element === selected) {
        return { position: 'sticky', top: '120px' } as CSSStyleDeclaration;
      }
      return { position: 'static', top: 'auto' } as CSSStyleDeclaration;
    });
    document.body.appendChild(selected);

    expect(dashboardChromeOffsetPx()).toBe(213);
  });

  it('includes a sticky selected-repo header in the scroll offset', () => {
    mountHeader(79);
    const selected = document.createElement('section');
    selected.className = 'selected-repo-header';
    Object.defineProperty(selected, 'getBoundingClientRect', {
      value: () => ({
        height: 51,
        top: 79,
        bottom: 130,
        width: 800,
        left: 0,
        right: 800,
        x: 0,
        y: 79,
      }),
    });
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      if (element === selected) {
        return { position: 'sticky' } as CSSStyleDeclaration;
      }
      return { position: 'static' } as CSSStyleDeclaration;
    });
    document.body.appendChild(selected);

    expect(dashboardChromeOffsetPx()).toBe(146);
  });

  it('scrolls the repository workspace with the same chrome offset', () => {
    mountHeader(80);
    mountTarget('repo-scan-workspace', 640);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });

    expect(scrollToRepoWorkspace()).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 544, behavior: 'instant' });
  });
});
