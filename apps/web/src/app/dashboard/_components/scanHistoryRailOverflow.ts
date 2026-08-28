/** Keep the active chip out of the edge fade. Matches `scroll-padding-inline`. */
export const SCAN_HISTORY_RAIL_EDGE_INSET = 24;

const OVERFLOW_THRESHOLD_PX = 1;

export interface RailOverflow {
  start: boolean;
  end: boolean;
}

export function readRailOverflow(element: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
}): RailOverflow {
  const horizontalMax = element.scrollWidth - element.clientWidth;
  if (horizontalMax > OVERFLOW_THRESHOLD_PX) {
    return {
      start: element.scrollLeft > OVERFLOW_THRESHOLD_PX,
      end: element.scrollLeft < horizontalMax - OVERFLOW_THRESHOLD_PX,
    };
  }

  const verticalMax = (element.scrollHeight ?? 0) - (element.clientHeight ?? 0);
  if (verticalMax > OVERFLOW_THRESHOLD_PX) {
    const scrollTop = element.scrollTop ?? 0;
    return {
      start: scrollTop > OVERFLOW_THRESHOLD_PX,
      end: scrollTop < verticalMax - OVERFLOW_THRESHOLD_PX,
    };
  }

  return { start: false, end: false };
}
