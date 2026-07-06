import { describe, expect, it } from 'vitest';
import { formatCount, pluralize } from './pluralize';

describe('pluralize', () => {
  it('returns the singular only for exactly 1', () => {
    expect(pluralize(1, 'Error')).toBe('Error');
    expect(pluralize(0, 'Error')).toBe('Errors');
    expect(pluralize(2, 'Error')).toBe('Errors');
  });

  it('supports an explicit plural for irregular nouns/phrases', () => {
    expect(pluralize(1, 'file affected', 'files affected')).toBe('file affected');
    expect(pluralize(3, 'file affected', 'files affected')).toBe('files affected');
  });
});

describe('formatCount', () => {
  it('prefixes the count and agrees in number', () => {
    expect(formatCount(1, 'Error')).toBe('1 Error');
    expect(formatCount(2, 'Error')).toBe('2 Errors');
    expect(formatCount(0, 'Warning')).toBe('0 Warnings');
    expect(formatCount(1, 'auto-fix')).toBe('1 auto-fix');
    expect(formatCount(1, 'unique error', 'unique errors')).toBe('1 unique error');
  });
});
