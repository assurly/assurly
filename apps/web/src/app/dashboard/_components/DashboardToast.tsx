'use client';

import type { ReactElement } from 'react';

export interface DashboardToastData {
  message: string;
  type: 'success' | 'error' | 'info';
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
      {toast.type === 'error' ? (
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
