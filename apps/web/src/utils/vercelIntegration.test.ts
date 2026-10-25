import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createVercelIntegrationApi,
  exchangeIntegrationCode,
  getVercelIntegrationConfig,
  VercelApiError,
  vercelIntegrationInstallUrl,
} from './vercelIntegration';
import { readVercelInstallState, signVercelInstallState } from './vercelInstallState';

const ORG = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('vercel integration', () => {
  beforeEach(() => {
    vi.stubEnv('APP_URL', 'https://assurly.dev');
    vi.stubEnv('VERCEL_TOKEN_KEY', Buffer.alloc(32, 7).toString('base64'));
    vi.stubEnv('VERCEL_INTEGRATION_CLIENT_ID', 'oac_client');
    vi.stubEnv('VERCEL_INTEGRATION_CLIENT_SECRET', 'secret');
    vi.stubEnv('VERCEL_INTEGRATION_SLUG', 'assurly-live-lock');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('is not configured until every value is set', () => {
    expect(getVercelIntegrationConfig()).toEqual({
      clientId: 'oac_client',
      clientSecret: 'secret',
      slug: 'assurly-live-lock',
    });
    vi.stubEnv('VERCEL_INTEGRATION_SLUG', '');
    expect(getVercelIntegrationConfig()).toBeNull();
  });

  it('builds the external install URL with the signed state', () => {
    expect(vercelIntegrationInstallUrl('assurly-live-lock', 'abc')).toBe(
      'https://vercel.com/integrations/assurly-live-lock/new?state=abc',
    );
  });

  it('exchanges the install code and keeps the team and installation ids', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ access_token: 'tok', team_id: 'team_1', installation_id: 'icfg_abc' }),
    );
    const installation = await exchangeIntegrationCode(
      'code-1',
      getVercelIntegrationConfig()!,
      fetchImpl as never,
    );
    expect(installation).toEqual({
      accessToken: 'tok',
      teamId: 'team_1',
      configurationId: 'icfg_abc',
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.vercel.com/v2/oauth/access_token');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('redirect_uri')).toBe('https://assurly.dev/api/vercel/integration/callback');
    expect(body.get('code')).toBe('code-1');
  });

  it('rejects an exchange without an installation id', async () => {
    const fetchImpl = vi.fn(async () => json({ access_token: 'tok' }));
    await expect(
      exchangeIntegrationCode('code-1', getVercelIntegrationConfig()!, fetchImpl as never),
    ).rejects.toBeInstanceOf(VercelApiError);
  });

  it('scopes every call to the team and registers a check Vercel accepts', async () => {
    const fetchImpl = vi.fn(async () => json({ id: 'check_1' }));
    const api = createVercelIntegrationApi('tok', 'team_1', fetchImpl as never);
    await api.createCheck('dpl_1', { blocking: true, detailsUrl: 'https://assurly.dev/dashboard' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.vercel.com/v1/deployments/dpl_1/checks?teamId=team_1');
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Assurly Live Lock',
      blocking: true,
      rerequestable: false,
      detailsUrl: 'https://assurly.dev/dashboard',
    });
  });

  it('reads only production domains of a project', async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        domains: [
          { name: 'App.Example.com' },
          { name: 'staging.example.com', gitBranch: 'staging' },
          { name: 'www.example.com', redirect: 'app.example.com' },
        ],
      }),
    );
    const api = createVercelIntegrationApi('tok', null, fetchImpl as never);
    expect(await api.productionHosts('prj_app')).toEqual(['app.example.com']);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://api.vercel.com/v9/projects/prj_app/domains?limit=100',
    );
  });

  it('surfaces a rejected call with its status', async () => {
    const fetchImpl = vi.fn(async () => json({}, 403));
    const api = createVercelIntegrationApi('tok', null, fetchImpl as never);
    await expect(api.listProjects()).rejects.toMatchObject({ status: 403 });
  });
});

describe('vercel install state', () => {
  beforeEach(() => vi.stubEnv('VERCEL_TOKEN_KEY', Buffer.alloc(32, 7).toString('base64')));
  afterEach(() => vi.unstubAllEnvs());

  it('round-trips the workspace and target', () => {
    const state = signVercelInstallState({ organizationId: ORG, targetId: TARGET }, 1_000);
    expect(readVercelInstallState(state, 2_000)).toEqual({ organizationId: ORG, targetId: TARGET });
  });

  it('rejects an expired or edited state', () => {
    const state = signVercelInstallState({ organizationId: ORG, targetId: TARGET }, 1_000);
    expect(readVercelInstallState(state, 1_000 + 31 * 60 * 1000)).toBeNull();
    const edited = state.replace(TARGET, '33333333-3333-4333-8333-333333333333');
    expect(readVercelInstallState(edited, 2_000)).toBeNull();
  });
});

describe('vercel error detail', () => {
  it("keeps Vercel's error code and message so a failed call can be diagnosed", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ error: { code: 'bad_request', message: 'Invalid request: detailsUrl is bad' } }, 400),
    );
    const api = createVercelIntegrationApi('tok', null, fetchImpl as never);
    await expect(
      api.createCheck('dpl_1', { blocking: false, detailsUrl: 'https://assurly.dev/dashboard' }),
    ).rejects.toMatchObject({
      status: 400,
      detail: 'bad_request Invalid request: detailsUrl is bad',
    });
  });

  it('does not put the token in the error', async () => {
    const fetchImpl = vi.fn(async () => json({ error: { code: 'forbidden', message: 'no' } }, 403));
    const api = createVercelIntegrationApi('super-secret-token', null, fetchImpl as never);
    const error = await api.listProjects().catch((caught: unknown) => caught);
    expect(String((error as Error).message)).not.toContain('super-secret-token');
  });
});
