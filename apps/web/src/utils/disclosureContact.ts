import { CONTACT_SUBJECT_PARAM } from './contactSubjects';

/**
 * Canonical coordinated-vulnerability-disclosure intake path.
 *
 * Trust page §13, `/.well-known/security.txt`, and the CRA reporting runbook
 * must all point here. The CRA contact consistency test fails if they drift.
 */
export const DISCLOSURE_CONTACT_SUBJECT = 'trust' as const;

/** Path + query + hash relative to the app origin (no leading origin). */
export const DISCLOSURE_CONTACT_PATH = `/?${CONTACT_SUBJECT_PARAM}=${DISCLOSURE_CONTACT_SUBJECT}#contact`;

/** Absolute Contact URL for security.txt (RFC 9116). */
export function disclosureContactUrl(appOrigin: string): string {
  const origin = appOrigin.replace(/\/$/, '');
  return `${origin}${DISCLOSURE_CONTACT_PATH}`;
}
