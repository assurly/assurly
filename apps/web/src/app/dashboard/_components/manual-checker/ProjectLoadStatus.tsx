'use client';

import type { ReactElement } from 'react';

export type ProjectLoadKind = 'folder' | 'zip' | 'drop';

export interface ProjectLoadState {
  kind: ProjectLoadKind;
  label: string;
}

interface ProjectLoadStatusProps {
  kind: ProjectLoadKind;
  label: string;
  variant: 'placeholder' | 'overlay';
}

function statusCopy(kind: ProjectLoadKind): { title: string; body: string } {
  switch (kind) {
    case 'folder':
      return {
        title: 'Reading project folder…',
        body: 'Scanning supported files in the browser. This can take a moment for large projects.',
      };
    case 'zip':
      return {
        title: 'Unpacking ZIP archive…',
        body: 'Extracting and filtering files locally — nothing is uploaded.',
      };
    case 'drop':
      return {
        title: 'Reading dropped files…',
        body: 'Scanning supported files in the browser. This can take a moment for large projects.',
      };
    default: {
      const neverKind: never = kind;
      return neverKind;
    }
  }
}

export function ProjectLoadStatus({ kind, label, variant }: ProjectLoadStatusProps): ReactElement {
  const copy = statusCopy(kind);
  const className =
    variant === 'overlay'
      ? 'project-load-status project-load-status--overlay'
      : 'project-load-status';

  return (
    <div className={className} role="status" aria-live="polite" data-testid="project-load-status">
      <span className="project-load-status__spinner" aria-hidden="true">
        <span className="dashboard-inline-spinner" />
      </span>
      <h4 className="project-load-status__title">{copy.title}</h4>
      {label ? <p className="project-load-status__label">{label}</p> : null}
      <p className="project-load-status__body">{copy.body}</p>
    </div>
  );
}
