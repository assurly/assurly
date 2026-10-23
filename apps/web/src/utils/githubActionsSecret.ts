import { githubHeaders, githubRepositoryApiUrl } from './githubApp';
import { sealGitHubSecret } from './githubSecretSeal';

export const LIVE_LOCK_API_KEY_SECRET = 'ASSURLY_API_KEY';
export const LIVE_LOCK_TARGET_URL_SECRET = 'ASSURLY_TARGET_URL';

export type ActionsSecretWrite = 'written' | 'permission_required';

interface PublicKeyResponse {
  key_id?: unknown;
  key?: unknown;
}

/**
 * Writes one Actions secret. The plaintext is sealed before it leaves the
 * process and is never placed in an error string.
 */
export async function putActionsSecret(options: {
  token: string;
  repositoryName: string;
  name: string;
  value: string;
  fetchImpl?: typeof fetch;
}): Promise<ActionsSecretWrite> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const keyUrl = githubRepositoryApiUrl(options.repositoryName, 'actions', 'secrets', 'public-key');
  const keyResponse = await fetchImpl(keyUrl, { headers: githubHeaders(options.token) });
  if (keyResponse.status === 401 || keyResponse.status === 403 || keyResponse.status === 404) {
    return 'permission_required';
  }
  if (!keyResponse.ok) {
    throw new Error(`GitHub Actions public key request failed (${keyResponse.status}).`);
  }
  const keyBody = (await keyResponse.json()) as PublicKeyResponse;
  if (typeof keyBody.key_id !== 'string' || typeof keyBody.key !== 'string') {
    throw new Error('GitHub Actions public key response is invalid.');
  }
  const recipient = decodeBase64(keyBody.key);
  const sealed = sealGitHubSecret(new TextEncoder().encode(options.value), recipient);
  const putUrl = githubRepositoryApiUrl(options.repositoryName, 'actions', 'secrets', options.name);
  const putResponse = await fetchImpl(putUrl, {
    method: 'PUT',
    headers: { ...githubHeaders(options.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      encrypted_value: encodeBase64(sealed),
      key_id: keyBody.key_id,
    }),
  });
  if (putResponse.status === 401 || putResponse.status === 403 || putResponse.status === 404) {
    return 'permission_required';
  }
  if (!putResponse.ok && putResponse.status !== 201 && putResponse.status !== 204) {
    throw new Error(`GitHub Actions secret write failed (${putResponse.status}).`);
  }
  return 'written';
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

function encodeBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}
