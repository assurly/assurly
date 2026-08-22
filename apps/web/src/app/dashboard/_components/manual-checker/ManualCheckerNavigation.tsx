import { useRef } from 'react';
import type { ManualCheckerTab } from './useManualScan';

const tabs: ReadonlyArray<{ id: ManualCheckerTab; label: string }> = [
  { id: 'sql', label: 'Supabase Migration (.sql)' },
  { id: 'stripe', label: 'Stripe & API Code (.ts/.tsx)' },
  { id: 'env', label: 'Env Variables (.env)' },
  { id: 'project', label: 'Project Folder / ZIP' },
];

interface ManualCheckerNavigationProps {
  activeTab: ManualCheckerTab;
  onChange: (tab: ManualCheckerTab) => void;
}

export function ManualCheckerNavigation({
  activeTab,
  onChange,
}: ManualCheckerNavigationProps): React.ReactElement {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const moveFocus = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    onChange(nextTab.id);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <>
      <div className="manual-checker-header">
        <h1>Interactive Config Checker</h1>
        <p>
          Paste configuration snippets or drag &amp; drop files to scan for security vulnerabilities
          instantly.
        </p>
      </div>
      <div className="sandbox-tabs" role="tablist" aria-label="Manual scanner modes">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`manual-tab-${tab.id}`}
            aria-controls={`manual-panel-${tab.id}`}
            aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={`sandbox-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => moveFocus(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </>
  );
}
