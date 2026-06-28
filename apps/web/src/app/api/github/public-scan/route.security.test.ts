import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

describe('public GitHub proxy security boundary', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('never exposes private content even when the server PAT can access it', async () => {
    process.env.GITHUB_PAT = 'server-pat';
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ private: true, default_branch: 'main' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request(
        'http://localhost/api/github/public-scan?repo=owner/private&type=file&branch=main&path=secret.txt',
      ),
    );
    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid repository and traversal input before network access', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(
      new Request(
        'http://localhost/api/github/public-scan?repo=owner%2Frepo&type=file&branch=main&path=..%2Fsecret',
      ),
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
