// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCAN_DETAILS_CONTAINER_ID, scrollToScanDetails } from './scrollToScanDetails';

describe('scrollToScanDetails', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns false when the scan details container is missing', () => {
    expect(scrollToScanDetails()).toBe(false);
  });

  it('scrolls the scan details container into view', () => {
    const target = document.createElement('div');
    target.id = SCAN_DETAILS_CONTAINER_ID;
    target.scrollIntoView = () => {};
    const scrollIntoView = vi.spyOn(target, 'scrollIntoView');
    document.body.appendChild(target);

    expect(scrollToScanDetails({ behavior: 'smooth', block: 'start' })).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });
});
