import { describe, expect, it, vi } from 'vitest';
import type { Repository, Target } from './dbAdapter';
import { enableLiveLock, type EnableLiveLockDeps } from './enableLiveLock';
import { PRODUCTION_IGNORE_BUILD_STEP } from './vercelLiveLock';

const PLAINTEXT = 'ask_live_lock_plaintext_do_not_leak';

function target(overrides: Partial<Target> = {}): Target {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    organization_id: 'org-1',
    kind: 'url',
    identifier: 'https://app.example.com',
    display_name: 'App',
    repository_id: null,
    generator_fingerprint: null,
    ownership_verified: true,
    ownership_method: 'dns_txt',
    current_verdict: 'blocked',
    current_ship_score: 59,
    verdict_evidence: null,
    last_checked_at: null,
    badge_token: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function repo(): Repository {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    organization_id: 'org-1',
    name: 'acme/app',
    github_repo_id: 42,
    is_active: true,
    created_at: '2026-10-01T00:00:00.000Z',
    homepage_url: 'https://app.example.com',
    default_branch: 'main',
  };
}

function deps(overrides: Partial<EnableLiveLockDeps> = {}): EnableLiveLockDeps {
  return {
    repositories: [repo()],
    installationId: '123',
    installUrl: 'https://github.com/apps/assurly/installations/new',
    vercelConfigured: true,
    vercel: {
      listProjects: async () => [
        {
          id: 'prj_owned',
          name: 'app',
          origins: ['https://app.example.com'],
          ignoredBuildStep: null,
        },
      ],
      setIgnoredBuildStep: vi.fn(async () => undefined),
    },
    createKey: async () => ({ plaintext: PLAINTEXT, revoke: async () => undefined }),
    writeSecret: vi.fn(async () => 'written' as const),
    openWorkflow: async () => ({ url: 'https://github.com/acme/app/pull/7', blocked: false }),
    saveProject: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('enableLiveLock', () => {
  it('does not put the API key in the result', async () => {
    const result = await enableLiveLock(target(), deps());
    expect(JSON.stringify(result)).not.toContain(PLAINTEXT);
    expect(result.status).toBe('locked');
  });

  it('asks for the GitHub permission and revokes the unused key', async () => {
    const revoke = vi.fn(async () => undefined);
    const result = await enableLiveLock(
      target(),
      deps({
        createKey: async () => ({ plaintext: PLAINTEXT, revoke }),
        writeSecret: async () => 'permission_required',
      }),
    );
    expect(result.status).toBe('github_permission_required');
    expect(result.installUrl).toContain('github.com/apps');
    expect(revoke).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain(PLAINTEXT);
  });

  it('does not overwrite a custom ignored-build command', async () => {
    const setIgnoredBuildStep = vi.fn();
    const result = await enableLiveLock(
      target(),
      deps({
        vercel: {
          listProjects: async () => [
            {
              id: 'prj_owned',
              name: 'app',
              origins: ['https://app.example.com'],
              ignoredBuildStep: 'exit 1',
            },
          ],
          setIgnoredBuildStep,
        },
      }),
    );
    expect(result.status).toBe('ignored_build_conflict');
    expect(setIgnoredBuildStep).not.toHaveBeenCalled();
  });

  it('sets the production ignore step and records the project', async () => {
    const setIgnoredBuildStep = vi.fn(async () => undefined);
    const saveProject = vi.fn(async () => undefined);
    const result = await enableLiveLock(
      target(),
      deps({
        vercel: {
          listProjects: async () => [
            {
              id: 'prj_owned',
              name: 'app',
              origins: ['https://app.example.com'],
              ignoredBuildStep: null,
            },
          ],
          setIgnoredBuildStep,
        },
        saveProject,
      }),
    );
    expect(result.status).toBe('locked');
    expect(setIgnoredBuildStep).toHaveBeenCalledWith('prj_owned', PRODUCTION_IGNORE_BUILD_STEP);
    expect(saveProject).toHaveBeenCalledWith(
      expect.objectContaining({
        vercelProjectId: 'prj_owned',
        productionDeployHeld: true,
        secretsWritten: true,
      }),
    );
  });

  it('stops when the URL is not tied to a repository', async () => {
    const writeSecret = vi.fn();
    const result = await enableLiveLock(target(), deps({ repositories: [], writeSecret }));
    expect(result.status).toBe('repo_required');
    expect(writeSecret).not.toHaveBeenCalled();
  });
});
