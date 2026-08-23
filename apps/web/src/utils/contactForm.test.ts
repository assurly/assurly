import { describe, expect, it } from 'vitest';
import { ClientApiError } from './clientApi';
import {
  CONTACT_INVALID_FIELDS,
  CONTACT_MESSAGE_MIN_LENGTH,
  CONTACT_MESSAGE_TOO_LONG,
  CONTACT_MESSAGE_TOO_SHORT,
  CONTACT_RATE_LIMITED,
  CONTACT_SUBMIT_FAILED,
  contactMessageLengthIssue,
  describeContactSubmitError,
} from './contactForm';

describe('contactMessageLengthIssue', () => {
  it('asks for a real message when the body is shorter than the minimum', () => {
    expect(contactMessageLengthIssue('ccc')).toBe(CONTACT_MESSAGE_TOO_SHORT);
    expect(contactMessageLengthIssue('  abc  ')).toBe(CONTACT_MESSAGE_TOO_SHORT);
    expect(contactMessageLengthIssue('a'.repeat(CONTACT_MESSAGE_MIN_LENGTH - 1))).toBe(
      CONTACT_MESSAGE_TOO_SHORT,
    );
  });

  it('accepts a trimmed message at the minimum length', () => {
    expect(contactMessageLengthIssue('a'.repeat(CONTACT_MESSAGE_MIN_LENGTH))).toBeNull();
    expect(contactMessageLengthIssue(`  ${'a'.repeat(CONTACT_MESSAGE_MIN_LENGTH)}  `)).toBeNull();
  });

  it('rejects a message over the maximum length', () => {
    expect(contactMessageLengthIssue('a'.repeat(2001))).toBe(CONTACT_MESSAGE_TOO_LONG);
  });
});

describe('describeContactSubmitError', () => {
  it('explains a rate-limit rejection without sounding like an outage', () => {
    expect(
      describeContactSubmitError(new ClientApiError('Too many requests.', 429, 'rate_limited')),
    ).toBe(CONTACT_RATE_LIMITED);
  });

  it('asks the user to review the form on validation failure', () => {
    expect(
      describeContactSubmitError(
        new ClientApiError('Request validation failed.', 400, 'invalid_request'),
      ),
    ).toBe(CONTACT_INVALID_FIELDS);
  });

  it('uses a calm fallback for unexpected failures', () => {
    expect(describeContactSubmitError(new Error('network down'))).toBe(CONTACT_SUBMIT_FAILED);
  });
});
