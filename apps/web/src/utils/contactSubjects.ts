/**
 * Single source of truth for contact-form subjects.
 *
 * The select options, the server-side deep-link validation, and the API's request
 * schema all derive from this list. Keeping them in one place prevents the failure
 * mode where a new option is added to the form but rejected by the API's enum,
 * which surfaces to the user as an unexplained validation error on submit.
 */

export const CONTACT_SUBJECTS = [
  { value: 'technical', label: 'Technical Support' },
  { value: 'bug', label: 'Bug Report' },
  { value: 'privacy', label: 'Privacy / Data Protection' },
  { value: 'terms', label: 'Terms of Service' },
  { value: 'trust', label: 'Trust & Security' },
  { value: 'business', label: 'Business / Acquisition Inquiry' },
  { value: 'other', label: 'Other' },
] as const;

export type ContactSubject = (typeof CONTACT_SUBJECTS)[number]['value'];

/** Non-empty tuple shape required by `z.enum`. */
export const CONTACT_SUBJECT_VALUES = CONTACT_SUBJECTS.map((subject) => subject.value) as [
  ContactSubject,
  ...ContactSubject[],
];

export const DEFAULT_CONTACT_SUBJECT: ContactSubject = 'technical';

/**
 * Narrows untrusted input (a URL query parameter) to a known subject. Anything
 * unrecognised is rejected so a crafted link cannot inject arbitrary text into
 * the form.
 */
export function isContactSubject(value: unknown): value is ContactSubject {
  return typeof value === 'string' && CONTACT_SUBJECT_VALUES.includes(value as ContactSubject);
}

/**
 * Query parameter used to preselect a subject, e.g. `/?subject=privacy#contact`.
 * Linked from the Privacy Policy and the Terms of Service so a data-subject
 * request, a contract question, or a withdrawal declaration lands on the form
 * with the right category already chosen.
 */
export const CONTACT_SUBJECT_PARAM = 'subject';
