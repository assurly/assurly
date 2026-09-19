import { describe, expect, it } from 'vitest';
import { PROBE_MAX_RESPONSE_BYTES } from './defaults';
import { RUNTIME_MAX_RESPONSE_BYTES } from '../runtimeScanner';

describe('probe defaults', () => {
  it('bounds a probe body by exactly the runtime scanner limit', () => {
    // `probes/` must not import runtimeScanner (it would be a cycle), so the cap
    // is duplicated. This test is what keeps the two from drifting apart.
    expect(PROBE_MAX_RESPONSE_BYTES).toBe(RUNTIME_MAX_RESPONSE_BYTES);
  });
});
