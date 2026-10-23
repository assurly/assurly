import { afterEach, describe, expect, it } from 'vitest';
import { createPkcePair, vercelAuthorizeUrl } from './vercelOauth';

describe('vercelAuthorizeUrl', () => {
  const previous = {
    app: process.env.APP_URL,
    client: process.env.VERCEL_CLIENT_ID,
  };

  afterEach(() => {
    process.env.APP_URL = previous.app;
    process.env.VERCEL_CLIENT_ID = previous.client;
  });

  it('asks Vercel for an authorization code with S256 PKCE', () => {
    process.env.APP_URL = 'https://assurly.dev';
    process.env.VERCEL_CLIENT_ID = 'cl_test';
    const { challenge } = createPkcePair();
    const url = new URL(vercelAuthorizeUrl('state-1', challenge));
    expect(url.origin + url.pathname).toBe('https://vercel.com/oauth/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe('https://assurly.dev/api/vercel/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(challenge);
    expect(url.searchParams.get('client_id')).toBe('cl_test');
  });
});
