import { describe, expect, it, vi } from 'vitest';
import nacl from 'tweetnacl';
import { putActionsSecret } from './githubActionsSecret';

describe('putActionsSecret', () => {
  it('sends a sealed value and not the plaintext', async () => {
    const pair = nacl.box.keyPair();
    const plaintext = 'ask_super_secret_value';
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        bodies.push(String(init.body));
        return new Response(null, { status: 201 });
      }
      return new Response(
        JSON.stringify({
          key_id: 'key_1',
          key: Buffer.from(pair.publicKey).toString('base64'),
        }),
        { status: 200 },
      );
    });
    const result = await putActionsSecret({
      token: 'installation-token',
      repositoryName: 'acme/app',
      name: 'ASSURLY_API_KEY',
      value: plaintext,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBe('written');
    expect(bodies[0]).not.toContain(plaintext);
    expect(bodies[0]).toContain('encrypted_value');
  });

  it('reports a missing secrets permission without throwing the value', async () => {
    const fetchImpl = vi.fn(async () => new Response('no', { status: 403 }));
    await expect(
      putActionsSecret({
        token: 'token',
        repositoryName: 'acme/app',
        name: 'ASSURLY_API_KEY',
        value: 'ask_hidden',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toBe('permission_required');
  });
});
