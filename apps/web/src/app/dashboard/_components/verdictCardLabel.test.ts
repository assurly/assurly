import { describe, expect, it } from 'vitest';
import { formatVerdictCardLabel } from './verdictCardLabel';

describe('formatVerdictCardLabel', () => {
  it('leads repo cards with the repo name and keeps the owner as secondary', () => {
    expect(formatVerdictCardLabel('tibco87/assurly', 'repo')).toEqual({
      primary: 'assurly',
      secondary: 'tibco87',
      full: 'tibco87/assurly',
    });
  });

  it('keeps a bare repo name as the primary label', () => {
    expect(formatVerdictCardLabel('chatbot', 'repo')).toEqual({
      primary: 'chatbot',
      secondary: null,
      full: 'chatbot',
    });
  });

  it('leads URL cards with the hostname and keeps the path secondary', () => {
    expect(formatVerdictCardLabel('https://gemini.google.com/app/abc123?x=1', 'url')).toEqual({
      primary: 'gemini.google.com',
      secondary: '/app/abc123?x=1',
      full: 'https://gemini.google.com/app/abc123?x=1',
    });
  });

  it('strips www and omits a bare root path for URL cards', () => {
    expect(formatVerdictCardLabel('https://www.v0.dev/', 'url')).toEqual({
      primary: 'v0.dev',
      secondary: null,
      full: 'https://www.v0.dev/',
    });
  });

  it('parses protocol-less URL identifiers', () => {
    expect(formatVerdictCardLabel('vercel.com/chatbot', 'url')).toEqual({
      primary: 'vercel.com',
      secondary: '/chatbot',
      full: 'vercel.com/chatbot',
    });
  });

  it('does not mis-parse a repo as a URL when kind is repo', () => {
    expect(formatVerdictCardLabel('acme/api', 'repo')).toEqual({
      primary: 'api',
      secondary: 'acme',
      full: 'acme/api',
    });
  });
});
