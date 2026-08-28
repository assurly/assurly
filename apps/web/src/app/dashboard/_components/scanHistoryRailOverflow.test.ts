import { describe, expect, it } from 'vitest';
import { readRailOverflow } from './scanHistoryRailOverflow';

describe('readRailOverflow', () => {
  it('reports no overflow when content fits', () => {
    expect(readRailOverflow({ scrollLeft: 0, scrollWidth: 200, clientWidth: 200 })).toEqual({
      start: false,
      end: false,
    });
  });

  it('ignores sub-pixel leftover as no overflow', () => {
    expect(readRailOverflow({ scrollLeft: 0, scrollWidth: 201, clientWidth: 200 })).toEqual({
      start: false,
      end: false,
    });
  });

  it('reports end only at the start of an overflowing rail', () => {
    expect(readRailOverflow({ scrollLeft: 0, scrollWidth: 400, clientWidth: 200 })).toEqual({
      start: false,
      end: true,
    });
  });

  it('reports start only at the end of an overflowing rail', () => {
    expect(readRailOverflow({ scrollLeft: 200, scrollWidth: 400, clientWidth: 200 })).toEqual({
      start: true,
      end: false,
    });
  });

  it('reports both when scrolled in the middle', () => {
    expect(readRailOverflow({ scrollLeft: 80, scrollWidth: 400, clientWidth: 200 })).toEqual({
      start: true,
      end: true,
    });
  });

  it('reports vertical overflow when the stacked list is taller than the viewport', () => {
    expect(
      readRailOverflow({
        scrollLeft: 0,
        scrollWidth: 200,
        clientWidth: 200,
        scrollTop: 0,
        scrollHeight: 400,
        clientHeight: 200,
      }),
    ).toEqual({ start: false, end: true });

    expect(
      readRailOverflow({
        scrollLeft: 0,
        scrollWidth: 200,
        clientWidth: 200,
        scrollTop: 200,
        scrollHeight: 400,
        clientHeight: 200,
      }),
    ).toEqual({ start: true, end: false });
  });
});
