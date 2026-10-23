import { blake2b } from 'blakejs';
import nacl from 'tweetnacl';

/**
 * libsodium `crypto_box_seal`: ephemeral public key, then a box whose nonce is
 * BLAKE2b-24 of that key concatenated with the recipient public key.
 * GitHub Actions secrets require this exact construction.
 */
export function sealGitHubSecret(message: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  if (recipientPublicKey.length !== nacl.box.publicKeyLength) {
    throw new Error('GitHub Actions public key must be 32 bytes.');
  }
  const ephemeral = nacl.box.keyPair();
  const nonce = sealNonce(ephemeral.publicKey, recipientPublicKey);
  const boxed = nacl.box(message, nonce, recipientPublicKey, ephemeral.secretKey);
  const sealed = new Uint8Array(ephemeral.publicKey.length + boxed.length);
  sealed.set(ephemeral.publicKey, 0);
  sealed.set(boxed, ephemeral.publicKey.length);
  return sealed;
}

/** Test helper. Opens a seal produced by `sealGitHubSecret`. */
export function openGitHubSecret(
  sealed: Uint8Array,
  recipientPublicKey: Uint8Array,
  recipientSecretKey: Uint8Array,
): Uint8Array | null {
  const ephemeralPublicKey = sealed.slice(0, nacl.box.publicKeyLength);
  const boxed = sealed.slice(nacl.box.publicKeyLength);
  const nonce = sealNonce(ephemeralPublicKey, recipientPublicKey);
  return nacl.box.open(boxed, nonce, ephemeralPublicKey, recipientSecretKey);
}

function sealNonce(ephemeralPublicKey: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  const material = new Uint8Array(ephemeralPublicKey.length + recipientPublicKey.length);
  material.set(ephemeralPublicKey, 0);
  material.set(recipientPublicKey, ephemeralPublicKey.length);
  return blake2b(material, null, nacl.box.nonceLength);
}
