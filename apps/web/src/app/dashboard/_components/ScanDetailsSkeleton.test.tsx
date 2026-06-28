// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScanDetailsSkeleton } from './ScanDetailsSkeleton';

describe('ScanDetailsSkeleton', () => {
  it('exposes an accessible loading state for the scan details panel', () => {
    render(<ScanDetailsSkeleton />);

    expect(screen.getByTestId('scan-details-skeleton')).toBeTruthy();
    expect(screen.getByLabelText('Loading scan details')).toBeTruthy();
    expect(document.querySelector('.scan-history-rail')).toBeTruthy();
  });
});
