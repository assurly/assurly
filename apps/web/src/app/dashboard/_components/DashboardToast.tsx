'use client';

import type { ReactElement } from 'react';

export interface DashboardToastData {
  message: string;
  type: 'success' | 'error' | 'info';
  /** Optional call-to-action link rendered inside the toast (opens in a new tab). */
  actionLabel?: string;
  actionHref?: string;
}

export interface DashboardToastProps {
  toast: DashboardToastData;
  onDismiss: () => void;
}

function getToastModifier(type: DashboardToastData['type']): string {
  switch (type) {
    case 'success':
      return 'dashboard-toast--success';
    case 'error':
      return 'dashboard-toast--error';
    case 'info':
      return 'dashboard-toast--info';
    default: {
      const neverType: never = type;
      return neverType;
    }
  }
}

function getToastIcon(type: DashboardToastData['type']): string {
  switch (type) {
    case 'success':
      return '✓';
    case 'error':
      return '✗';
    case 'info':
      return 'ℹ';
    default: {
      const neverType: never = type;
      return neverType;
    }
  }
}

export function DashboardToast({ toast, onDismiss }: DashboardToastProps): ReactElement {
  return (
    <div
      className={`dashboard-toast ${getToastModifier(toast.type)}`}
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
    >
      <span className="dashboard-toast__icon" aria-hidden="true">
        {getToastIcon(toast.type)}
      </span>
      <span className="dashboard-toast__message">{toast.message}</span>
      {toast.actionHref ? (
        <a
          className="dashboard-toast__action"
          href={toast.actionHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          {toast.actionLabel ?? 'Open'}
        </a>
      ) : null}
      {toast.type === 'error' || toast.actionHref ? (
        <button
          type="button"
          className="dashboard-toast__dismiss"
          aria-label="Dismiss notification"
          onClick={onDismiss}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
