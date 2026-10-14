import { describe, expect, it, vi } from 'vitest';
import { deleteClosedFixBranch, type ClosedFixPullRequest } from './githubFixBranchCleanup';

const HEAD = 'a'.repeat(40);
const CLOSED: ClosedFixPullRequest = {
  repositoryName: 'owner/app',
  headRepositoryName: 'owner/app',
  branch: 'assurly-fix-0123456789ab',
  headSha: HEAD,
};

function refResponse(sha: string) {
  return new Response(JSON.stringify({ object: { sha } }), { status: 200 });
}

describe('deleteClosedFixBranch', () => {
  it('deletes the fix branch when it still points at the closed head', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(refResponse(HEAD))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(deleteClosedFixBranch(CLOSED, 'token', fetchMock)).resolves.toBe('deleted');

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/owner/app/git/ref/heads/assurly-fix-0123456789ab',
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.github.com/repos/owner/app/git/refs/heads/assurly-fix-0123456789ab',
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'DELETE' });
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer token');
  });

  it('keeps the branch when someone pushed to it after the pull request closed', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(refResponse('b'.repeat(40)));
    await expect(deleteClosedFixBranch(CLOSED, 'token', fetchMock)).resolves.toBe('skipped');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('never touches a branch that is not one of Assurly’s', async () => {
    const fetchMock = vi.fn();
    await expect(
      deleteClosedFixBranch({ ...CLOSED, branch: 'feature/login' }, 'token', fetchMock),
    ).resolves.toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves branches in a fork alone', async () => {
    const fetchMock = vi.fn();
    await expect(
      deleteClosedFixBranch({ ...CLOSED, headRepositoryName: 'someone/app' }, 'token', fetchMock),
    ).resolves.toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cleans up pre-rename shipready-fix branches too', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(refResponse(HEAD))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(
      deleteClosedFixBranch({ ...CLOSED, branch: 'shipready-fix-abc' }, 'token', fetchMock),
    ).resolves.toBe('deleted');
  });

  it('reports a branch already deleted (for example by GitHub’s own setting)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 404 }));
    await expect(deleteClosedFixBranch(CLOSED, 'token', fetchMock)).resolves.toBe('already-gone');
  });

  it('surfaces a permission failure instead of claiming success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(refResponse(HEAD))
      .mockResolvedValueOnce(new Response('{}', { status: 403 }));
    await expect(deleteClosedFixBranch(CLOSED, 'token', fetchMock)).rejects.toThrow('HTTP 403');
  });
});
