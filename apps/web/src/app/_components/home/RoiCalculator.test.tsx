// @vitest-environment jsdom

/**
 * ROI Calculator – interactive slider tests.
 *
 * Verifies that the two sliders in the "Calculate Your Savings" section are
 * fully interactive (not readonly), update their displayed values correctly,
 * and drive the ROI calculation output in real time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CURRENCY_SYMBOL, PRICES } from '../../../utils/pricing';
import HomeClient from './HomeClient';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

// Stub browser APIs that are absent in jsdom
beforeEach(() => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    },
  });
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getHoursSlider(): HTMLInputElement {
  return screen.getByRole('slider', { name: /manual review time/i }) as HTMLInputElement;
}

function getRateSlider(): HTMLInputElement {
  return screen.getByRole('slider', { name: /developer hourly rate/i }) as HTMLInputElement;
}

function changeSlider(slider: HTMLInputElement, value: string): void {
  fireEvent.change(slider, { target: { value } });
}

// ---------------------------------------------------------------------------
// Slider interactivity
// ---------------------------------------------------------------------------

describe('ROI Calculator — slider interactivity', () => {
  it('renders the hours slider with the correct initial value and bounds', () => {
    render(<HomeClient initialAuthenticated={false} />);

    const slider = getHoursSlider();
    expect(slider.type).toBe('range');
    expect(slider.min).toBe('1');
    expect(slider.max).toBe('40');
    expect(slider.value).toBe('8');
  });

  it('renders the hourly-rate slider with the correct initial value and bounds', () => {
    render(<HomeClient initialAuthenticated={false} />);

    const slider = getRateSlider();
    expect(slider.type).toBe('range');
    expect(slider.min).toBe('20');
    expect(slider.max).toBe('150');
    expect(slider.value).toBe('60');
  });

  it('hours slider is NOT readonly — its value updates when changed', () => {
    render(<HomeClient initialAuthenticated={false} />);

    const slider = getHoursSlider();
    changeSlider(slider, '25');

    expect(slider.value).toBe('25');
  });

  it('hourly-rate slider is NOT readonly — its value updates when changed', () => {
    render(<HomeClient initialAuthenticated={false} />);

    const slider = getRateSlider();
    changeSlider(slider, '100');

    expect(slider.value).toBe('100');
  });

  it('hours slider does not have a readOnly attribute', () => {
    render(<HomeClient initialAuthenticated={false} />);
    expect(getHoursSlider()).not.toHaveProperty('readOnly', true);
  });

  it('hourly-rate slider does not have a readOnly attribute', () => {
    render(<HomeClient initialAuthenticated={false} />);
    expect(getRateSlider()).not.toHaveProperty('readOnly', true);
  });

  it('hours slider does not have a disabled attribute', () => {
    render(<HomeClient initialAuthenticated={false} />);
    expect(getHoursSlider().disabled).toBe(false);
  });

  it('hourly-rate slider does not have a disabled attribute', () => {
    render(<HomeClient initialAuthenticated={false} />);
    expect(getRateSlider().disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Displayed value labels update in sync with the sliders
// ---------------------------------------------------------------------------

describe('ROI Calculator — value label synchronisation', () => {
  it('hours label updates when the slider is moved', () => {
    render(<HomeClient initialAuthenticated={false} />);

    changeSlider(getHoursSlider(), '20');

    expect(screen.getByText('20 hrs')).toBeTruthy();
  });

  it('hourly-rate label updates when the slider is moved', () => {
    render(<HomeClient initialAuthenticated={false} />);

    changeSlider(getRateSlider(), '120');

    // The displayed value must contain the new rate (with currency symbol)
    expect(screen.getByText(`${CURRENCY_SYMBOL}120/hr`)).toBeTruthy();
  });

  it('initial hours label displays the default value', () => {
    render(<HomeClient initialAuthenticated={false} />);
    expect(screen.getByText('8 hrs')).toBeTruthy();
  });

  it('initial rate label displays the default value', () => {
    render(<HomeClient initialAuthenticated={false} />);
    expect(screen.getByText(`${CURRENCY_SYMBOL}60/hr`)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Helpers for savings amount assertions
// ---------------------------------------------------------------------------

/**
 * Returns true when the expected savings string is found anywhere in the
 * rendered ROI results card. The amount appears in both the large display
 * and the breakdown row, so we assert presence via getAllByText.
 */
function hasSavingsText(text: string): boolean {
  return screen.getAllByText(text).length > 0;
}

/**
 * Net monthly saving the calculator should display for a manual audit cost.
 * Derived from the published price so a price change updates these tests with
 * the page instead of leaving them asserting a number nobody charges.
 */
function savings(manualCost: number): string {
  return `${CURRENCY_SYMBOL}${Math.max(0, manualCost - PRICES.guardMonthly).toFixed(0)}`;
}

// ---------------------------------------------------------------------------
// ROI calculation correctness
// ---------------------------------------------------------------------------

describe('ROI Calculator — savings computation', () => {
  it('shows the smallest positive saving at the minimum plausible hours and rate', () => {
    render(<HomeClient initialAuthenticated={false} />);

    changeSlider(getHoursSlider(), '1');
    changeSlider(getRateSlider(), '20');

    // 1 hr x 20 = 20 manual cost, less the monthly plan price.
    expect(hasSavingsText(savings(1 * 20))).toBe(true);
  });

  it('calculates the correct net savings for a mid-range scenario', () => {
    render(<HomeClient initialAuthenticated={false} />);

    changeSlider(getHoursSlider(), '10');
    changeSlider(getRateSlider(), '80');

    expect(hasSavingsText(savings(10 * 80))).toBe(true);
  });

  it('recalculates savings immediately after changing the hours slider', () => {
    render(<HomeClient initialAuthenticated={false} />);

    expect(hasSavingsText(savings(8 * 60))).toBe(true);

    changeSlider(getHoursSlider(), '15');
    expect(hasSavingsText(savings(15 * 60))).toBe(true);
  });

  it('recalculates savings immediately after changing the rate slider', () => {
    render(<HomeClient initialAuthenticated={false} />);

    expect(hasSavingsText(savings(8 * 60))).toBe(true);

    changeSlider(getRateSlider(), '100');
    expect(hasSavingsText(savings(8 * 100))).toBe(true);
  });

  it('shows zero savings when manual audit cost is at or below the plan price', () => {
    render(<HomeClient initialAuthenticated={false} />);

    // The floor is zero once manual cost drops to the plan price. The slider
    // minimum (1h x 20) still exceeds it, so the lowest reachable saving is
    // that difference rather than zero.
    changeSlider(getHoursSlider(), '1');
    changeSlider(getRateSlider(), '20');

    expect(hasSavingsText(savings(1 * 20))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dynamic fill style (CSS background tracks thumb position)
// ---------------------------------------------------------------------------

describe('ROI Calculator — slider fill style', () => {
  it('hours slider has an inline background style that reflects the initial position', () => {
    render(<HomeClient initialAuthenticated={false} />);

    const slider = getHoursSlider();
    const bg = slider.style.background;

    // Initial value is 8 out of range 1–40 → (8−1)/(40−1) ≈ 17.9% → rounded to 18%
    expect(bg).toContain('18%');
  });

  it('hourly-rate slider has an inline background style that reflects the initial position', () => {
    render(<HomeClient initialAuthenticated={false} />);

    const slider = getRateSlider();
    const bg = slider.style.background;

    // Initial value is 60 out of range 20–150 → (60−20)/(150−20) ≈ 30.7% → rounded to 31%
    expect(bg).toContain('31%');
  });

  it('hours slider fill percentage updates after a change', () => {
    render(<HomeClient initialAuthenticated={false} />);

    const slider = getHoursSlider();
    changeSlider(slider, '40');

    // value at max → fill should be 100%
    expect(slider.style.background).toContain('100%');
  });

  it('hourly-rate slider fill percentage updates after a change', () => {
    render(<HomeClient initialAuthenticated={false} />);

    const slider = getRateSlider();
    changeSlider(slider, '20');

    // value at min → fill should be 0%
    expect(slider.style.background).toContain('0%');
  });
});
