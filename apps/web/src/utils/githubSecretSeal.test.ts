import { describe, expect, it } from 'vitest';
import nacl from 'tweetnacl';
import { openGitHubSecret, sealGitHubSecret } from './githubSecretSeal';

describe('sealGitHubSecret', () => {
  it('round-trips a value the recipient can open', () => {
    const pair = nacl.box.keyPair();
    const message = new TextEncoder().encode('ask_live_lock_example');
    const sealed = sealGitHubSecret(message, pair.publicKey);
    const opened = openGitHubSecret(sealed, pair.publicKey, pair.secretKey);
    expect(opened).not.toBeNull();
    expect(new TextDecoder().decode(opened ?? new Uint8Array())).toBe('ask_live_lock_example');
  });

  it('rejects a public key that is not 32 bytes', () => {
    expect(() => sealGitHubSecret(new Uint8Array([1]), new Uint8Array(16))).toThrow(/32 bytes/);
  });
});
