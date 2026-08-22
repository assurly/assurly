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
}): RailOverflow {
  const maxScroll = element.scrollWidth - element.clientWidth;
  if (maxScroll <= OVERFLOW_THRESHOLD_PX) {
    return { start: false, end: false };
  }

  return {
    start: element.scrollLeft > OVERFLOW_THRESHOLD_PX,
    end: element.scrollLeft < maxScroll - OVERFLOW_THRESHOLD_PX,
  };
}
