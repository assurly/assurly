export const SCAN_DETAILS_CONTAINER_ID = 'scan-details-container';

export function scrollToScanDetails(
  options: ScrollIntoViewOptions = { behavior: 'smooth', block: 'start' },
): boolean {
  const target = document.getElementById(SCAN_DETAILS_CONTAINER_ID);
  if (!target) {
    return false;
  }

  target.scrollIntoView(options);
  return true;
}
