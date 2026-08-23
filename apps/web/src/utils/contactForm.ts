import { ClientApiError } from './clientApi';

/** Matches the contact API schema so the form cannot drift from the server. */
export const CONTACT_NAME_MAX_LENGTH = 100;
export const CONTACT_EMAIL_MAX_LENGTH = 254;
export const CONTACT_MESSAGE_MIN_LENGTH = 10;
export const CONTACT_MESSAGE_MAX_LENGTH = 2000;

export const CONTACT_MESSAGE_HINT = `Minimum ${CONTACT_MESSAGE_MIN_LENGTH} characters — a sentence or two is enough.`;

export const CONTACT_MESSAGE_TOO_SHORT = `Please include at least ${CONTACT_MESSAGE_MIN_LENGTH} characters so we can understand your request.`;

export const CONTACT_MESSAGE_TOO_LONG = `Please keep your message under ${CONTACT_MESSAGE_MAX_LENGTH} characters.`;

export const CONTACT_INVALID_FIELDS = 'Please check your name, email, and message, then try again.';

export const CONTACT_RATE_LIMITED = 'Please wait a few minutes before sending another message.';

export const CONTACT_SUBMIT_FAILED =
  'We could not send your message. Please try again in a moment.';

export function contactMessageLengthIssue(message: string): string | null {
  const trimmed = message.trim();
  if (trimmed.length < CONTACT_MESSAGE_MIN_LENGTH) {
    return CONTACT_MESSAGE_TOO_SHORT;
  }
  if (trimmed.length > CONTACT_MESSAGE_MAX_LENGTH) {
    return CONTACT_MESSAGE_TOO_LONG;
  }
  return null;
}

export function describeContactSubmitError(error: unknown): string {
  if (error instanceof ClientApiError) {
    if (error.status === 429 || error.code === 'rate_limited') {
      return CONTACT_RATE_LIMITED;
    }
    if (error.status === 400 || error.code === 'invalid_request') {
      return CONTACT_INVALID_FIELDS;
    }
  }
  return CONTACT_SUBMIT_FAILED;
}
