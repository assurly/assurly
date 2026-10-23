import { describe, expect, it } from 'vitest';
import {
  codeChangedSinceCheck,
  daysSinceCheck,
  freshnessNote,
  verdictFreshness,
} from './verdictFreshness';

const NOW = Date.parse('2026-10-23T09:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

const HEAD = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);

describe('verdictFreshness', () => {
  it('is current for a check from today at the newest commit', () => {
    expect(
      verdictFreshness(
        { checkedAt: ago(DAY / 2), checkedCommitSha: HEAD, headCommitSha: HEAD },
        NOW,
      ),
    ).toEqual({ status: 'current', daysOld: 1 });
  });

  it('is out of date the moment a newer commit lands, however recent the check', () => {
    expect(
      verdictFreshness(
        { checkedAt: ago(60_000), checkedCommitSha: OLDER, headCommitSha: HEAD },
        NOW,
      ),
    ).toEqual({ status: 'code_changed', daysOld: 0 });
  });

  it('falls back to age when no commit is known', () => {
    expect(verdictFreshness({ checkedAt: ago(128 * DAY) }, NOW)).toEqual({
      status: 'old',
      daysOld: 128,
    });
    expect(verdictFreshness({ checkedAt: ago(6 * DAY) }, NOW).status).toBe('current');
    expect(verdictFreshness({ checkedAt: ago(7 * DAY) }, NOW).status).toBe('old');
  });

  it('reports a code change ahead of age', () => {
    expect(
      verdictFreshness(
        { checkedAt: ago(30 * DAY), checkedCommitSha: OLDER, headCommitSha: HEAD },
        NOW,
      ).status,
    ).toBe('code_changed');
  });

  it('is unknown when there was never a check', () => {
    expect(verdictFreshness({ checkedAt: null }, NOW)).toEqual({
      status: 'unknown',
      daysOld: null,
    });
    expect(verdictFreshness({ checkedAt: 'not a date' }, NOW).status).toBe('unknown');
  });
});

describe('codeChangedSinceCheck', () => {
  it('never treats a placeholder commit as a change', () => {
    for (const placeholder of ['unknown', 'cli', 'local', '', null, undefined]) {
      expect(codeChangedSinceCheck(placeholder, HEAD)).toBe(false);
      expect(codeChangedSinceCheck(HEAD, placeholder)).toBe(false);
    }
  });

  it('matches a short SHA to its full form, case-insensitively', () => {
    expect(codeChangedSinceCheck('AAAAAAA', HEAD)).toBe(false);
    expect(codeChangedSinceCheck(HEAD, 'aaaaaaa')).toBe(false);
    expect(codeChangedSinceCheck('bbbbbbb', HEAD)).toBe(true);
  });
});

describe('daysSinceCheck', () => {
  it('rounds the way the "Checked 9d ago" line does', () => {
    expect(daysSinceCheck(ago(8.6 * DAY), NOW)).toBe(9);
    expect(daysSinceCheck(ago(8.4 * DAY), NOW)).toBe(8);
  });
});

describe('freshnessNote', () => {
  it('says why a verdict is out of date and stays quiet while it is current', () => {
    expect(freshnessNote({ status: 'code_changed', daysOld: 0 })).toBe(
      'The code has changed since this check.',
    );
    expect(freshnessNote({ status: 'old', daysOld: 128 })).toBe(
      'This check is 128 days old; the code may have changed since.',
    );
    expect(freshnessNote({ status: 'old', daysOld: 1 })).toMatch(/1 day old/);
    expect(freshnessNote({ status: 'current', daysOld: 2 })).toBeNull();
  });
});
