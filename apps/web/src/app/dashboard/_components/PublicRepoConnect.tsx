'use client';

import type { FormEvent, ReactElement } from 'react';
import { isLikelyPublicRepoInput } from '../../../utils/publicRepoInput';

export interface PublicRepoConnectProps {
  publicRepoInput: string;
  isAddingRepo: boolean;
  connectError?: string | null;
  onInputChange: (value: string) => void;
  onSubmit: (event?: FormEvent) => void;
}

const HINT_ID = 'dashboard-public-repository-hint';
const ERROR_ID = 'dashboard-public-repository-error';

export function PublicRepoConnect({
  publicRepoInput,
  isAddingRepo,
  connectError = null,
  onInputChange,
  onSubmit,
}: PublicRepoConnectProps): ReactElement {
  const isValid = isLikelyPublicRepoInput(publicRepoInput);
  const showInvalidHint = publicRepoInput.trim().length > 0 && !isValid;
  const describedBy = [showInvalidHint ? HINT_ID : null, connectError ? ERROR_ID : null]
    .filter(Boolean)
    .join(' ');

  return (
    <section className="dashboard-public-connect" aria-label="Scan public repository">
      <h4 className="dashboard-public-connect__title">Scan Public Repository</h4>
      <p className="dashboard-public-connect__copy">
        Quickly connect and scan any public GitHub repository without installing the app.
      </p>

      <form className="dashboard-public-connect__form" onSubmit={(event) => onSubmit(event)}>
        <label className="visually-hidden" htmlFor="dashboard-public-repository">
          Public GitHub repository
        </label>
        <input
          id="dashboard-public-repository"
          type="text"
          className="dashboard-public-connect__input"
          placeholder="owner/repo (e.g. facebook/react)"
          value={publicRepoInput}
          onChange={(event) => onInputChange(event.target.value)}
          disabled={isAddingRepo}
          aria-invalid={showInvalidHint}
          aria-describedby={describedBy || undefined}
        />
        <button
          type="submit"
          className="dashboard-public-connect__submit"
          disabled={isAddingRepo || !isValid}
          aria-busy={isAddingRepo}
        >
          {isAddingRepo ? 'Adding...' : 'Connect & Scan'}
        </button>
      </form>

      {showInvalidHint ? (
        <p id={HINT_ID} className="dashboard-public-connect__hint">
          Enter owner/repo — for example facebook/react
        </p>
      ) : null}

      {connectError ? (
        <p id={ERROR_ID} className="dashboard-public-connect__error" role="alert">
          {connectError}
        </p>
      ) : null}
    </section>
  );
}
