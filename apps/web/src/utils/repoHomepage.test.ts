import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeUrlIdentifier } from './ownership/gate';
import { learnRepositoryHomepage, normalizeHomepageOrigin } from './repoHomepage';

describe('normalizeHomepageOrigin', () => {
  it('prefixes https:// when GitHub stored a bare host', () => {
    expect(normalizeHomepageOrigin('assurly.dev')).toBe('https://assurly.dev');
  });

  it('returns the origin and drops path and query', () => {
    expect(normalizeHomepageOrigin('https://app.example.com/docs?x=1')).toBe(
      'https://app.example.com',
    );
  });

  it('returns null for empty or missing values', () => {
    expect(normalizeHomepageOrigin('')).toBeNull();
    expect(normalizeHomepageOrigin('   ')).toBeNull();
    expect(normalizeHomepageOrigin(null)).toBeNull();
    expect(normalizeHomepageOrigin(undefined)).toBeNull();
  });

  it('rejects private hosts and non-http(s) schemes', () => {
    expect(normalizeHomepageOrigin('http://10.0.0.5')).toBeNull();
    expect(normalizeHomepageOrigin('javascript:alert(1)')).toBeNull();
  });

  it('equals normalizeUrlIdentifier for a normal public site', () => {
    const site = 'https://app.example.com/pricing?ref=1';
    expect(normalizeHomepageOrigin(site)).toBe(normalizeUrlIdentifier(site));
  });
});

describe('learnRepositoryHomepage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function dbDouble() {
    return {
      updateRepositoryHomepageUrl: vi.fn().mockResolvedValue(undefined),
    };
  }

  const repository = {
    id: 'repo-1',
    organization_id: 'org-1',
    name: 'acme/app',
    github_repo_id: 1,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    homepage_url: null as string | null | undefined,
  };

  it('writes when the normalized origin differs from the stored value', async () => {
    const db = dbDouble();
    await learnRepositoryHomepage(db, repository, 'https://app.example.com/docs');
    expect(db.updateRepositoryHomepageUrl).toHaveBeenCalledWith(
      'repo-1',
      'https://app.example.com',
    );
  });

  it('skips the write when the stored origin already matches', async () => {
    const db = dbDouble();
    await learnRepositoryHomepage(
      db,
      { ...repository, homepage_url: 'https://app.example.com' },
      'https://app.example.com/docs?x=1',
    );
    expect(db.updateRepositoryHomepageUrl).not.toHaveBeenCalled();
  });

  it('writes null when GitHub cleared the homepage', async () => {
    const db = dbDouble();
    await learnRepositoryHomepage(
      db,
      { ...repository, homepage_url: 'https://app.example.com' },
      null,
    );
    expect(db.updateRepositoryHomepageUrl).toHaveBeenCalledWith('repo-1', null);
  });

  it('does not write when the homepage field is missing', async () => {
    const db = dbDouble();
    await learnRepositoryHomepage(
      db,
      { ...repository, homepage_url: 'https://app.example.com' },
      undefined,
    );
    expect(db.updateRepositoryHomepageUrl).not.toHaveBeenCalled();
  });

  it('logs and does not throw when the write fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = {
      updateRepositoryHomepageUrl: vi.fn().mockRejectedValue(new Error('column missing')),
    };
    await expect(
      learnRepositoryHomepage(db, repository, 'https://app.example.com'),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logged).toContain('repo-homepage-write-failed');
    expect(logged).toContain('repo-1');
    expect(logged).toContain('column missing');
  });
});
