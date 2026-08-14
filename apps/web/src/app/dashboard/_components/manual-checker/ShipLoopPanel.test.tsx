// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeAppliedFix, resetShipLoopFixIdCounterForTests } from './shipLoopJournal';
import { ShipLoopPanel } from './ShipLoopPanel';
import type { WebFinding } from '../../../../utils/browserScanner';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  resetShipLoopFixIdCounterForTests();
});

const remainingFinding: WebFinding = {
  ruleId: 'undocumented-env',
  severity: 'warning',
  file: 'config.ts',
  line: 1,
  message:
    "Environment variable 'process.env.STRIPE_SECRET_KEY' is used but not documented in '.env.example'.",
};

describe('ShipLoopPanel', () => {
  it('hides when not visible', () => {
    const { container } = render(
      <ShipLoopPanel
        visible={false}
        appliedFixes={[]}
        remainingFindings={[remainingFinding]}
        shipGateStatus="review"
        shipScore={92}
        blockerCount={0}
        warningCount={1}
        scannedFileCount={2}
        cleanFileCount={1}
        projectName="demo"
        mode="project"
        onUndoLast={vi.fn()}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('ship-loop-handoff')).toBeNull();
  });

  it('shows What changed and Undo only on the latest fix', () => {
    const onUndoLast = vi.fn();
    const fixes = [
      describeAppliedFix({ kind: 'rls', detail: 'profiles', filePaths: ['a.sql'] }),
      describeAppliedFix({ kind: 'stripe', filePaths: ['route.ts'] }),
    ];

    render(
      <ShipLoopPanel
        visible
        appliedFixes={fixes}
        remainingFindings={[]}
        shipGateStatus="ready"
        shipScore={100}
        blockerCount={0}
        warningCount={0}
        scannedFileCount={2}
        cleanFileCount={2}
        projectName="demo"
        mode="project"
        onUndoLast={onUndoLast}
      />,
    );

    expect(screen.getByTestId('ship-loop-what-changed')).toBeTruthy();
    expect(screen.getByText('Assurly enabled Row-Level Security on profiles.')).toBeTruthy();
    expect(screen.getByText('Assurly added Stripe signature verification.')).toBeTruthy();

    const undoButtons = screen.getAllByTestId('ship-loop-undo');
    expect(undoButtons).toHaveLength(1);
    fireEvent.click(undoButtons[0]!);
    expect(onUndoLast).toHaveBeenCalledTimes(1);
  });

  it('shows handoff when findings remain and hides it when none remain', () => {
    const { rerender } = render(
      <ShipLoopPanel
        visible
        appliedFixes={[]}
        remainingFindings={[remainingFinding]}
        shipGateStatus="review"
        shipScore={92}
        blockerCount={0}
        warningCount={1}
        scannedFileCount={2}
        cleanFileCount={1}
        projectName="demo"
        mode="snippet"
        onUndoLast={vi.fn()}
      />,
    );

    expect(screen.getByTestId('ship-loop-handoff')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Continue in Cursor \/ Claude/i })).toBeTruthy();

    rerender(
      <ShipLoopPanel
        visible
        appliedFixes={[]}
        remainingFindings={[]}
        shipGateStatus="ready"
        shipScore={100}
        blockerCount={0}
        warningCount={0}
        scannedFileCount={2}
        cleanFileCount={2}
        projectName="demo"
        mode="snippet"
        onUndoLast={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('ship-loop-handoff')).toBeNull();
  });

  it('shows Ship Receipt only when status is ready', () => {
    const { rerender } = render(
      <ShipLoopPanel
        visible
        appliedFixes={[]}
        remainingFindings={[]}
        shipGateStatus="review"
        shipScore={92}
        blockerCount={0}
        warningCount={1}
        scannedFileCount={2}
        cleanFileCount={1}
        projectName="demo"
        mode="project"
        onUndoLast={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('ship-loop-receipt')).toBeNull();

    rerender(
      <ShipLoopPanel
        visible
        appliedFixes={[]}
        remainingFindings={[]}
        shipGateStatus="ready"
        shipScore={100}
        blockerCount={0}
        warningCount={0}
        scannedFileCount={2}
        cleanFileCount={2}
        projectName="demo"
        mode="project"
        onUndoLast={vi.fn()}
      />,
    );

    expect(screen.getByTestId('ship-loop-receipt')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Copy Ship Receipt/i })).toBeTruthy();
  });
});
