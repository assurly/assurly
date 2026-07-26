import { describe, expect, it } from 'vitest';
import { damerauLevenshtein, findNearestCorpusMatch } from './editDistance';

describe('damerauLevenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(damerauLevenshtein('react', 'react')).toBe(0);
  });

  it('counts an adjacent transposition as distance 1', () => {
    // lodash → lodahs swaps the final "sh" pair.
    expect(damerauLevenshtein('lodash', 'lodahs')).toBe(1);
  });

  it('counts adjacent transposition as distance 1', () => {
    expect(damerauLevenshtein('ab', 'ba')).toBe(1);
  });

  it('handles empty strings', () => {
    expect(damerauLevenshtein('', 'abc')).toBe(3);
    expect(damerauLevenshtein('abc', '')).toBe(3);
  });
});

describe('findNearestCorpusMatch', () => {
  const corpus = ['lodash', 'react', 'jscodeshift', 'express', 'axios'];

  it('finds a near miss within distance 2', () => {
    const match = findNearestCorpusMatch('lodahs', corpus, 2);
    expect(match).toEqual({ name: 'lodash', distance: 1 });
  });

  it('returns null when nothing is within max distance', () => {
    expect(findNearestCorpusMatch('completely-unrelated-pkg', corpus, 2)).toBeNull();
  });

  it('skips exact corpus matches (not a proximity hit against itself)', () => {
    expect(findNearestCorpusMatch('react', corpus, 2)).toBeNull();
  });
});
