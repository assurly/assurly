import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { plantCanaryLocally } from './canaryPlant';

describe('plantCanaryLocally', () => {
  it('appends ASSURLY_CANARY_URL to .env.example from the hosted mint', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assurly-cli-plant-'));
    try {
      fs.writeFileSync(path.join(tempDir, '.env.example'), 'DATABASE_URL=\n');
      const snippet =
        'ASSURLY_CANARY_URL=https://assurly.dev/api/canary/ask_canary_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const fetchImpl = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            snippet,
            callbackUrl:
              'https://assurly.dev/api/canary/ask_canary_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
      );

      const result = await plantCanaryLocally({
        projectPath: tempDir,
        repo: 'acme/app',
        apiKey: 'ask_test',
        apiBaseUrl: 'https://assurly.dev',
        fetchImpl,
      });

      expect(result.changed).toBe(true);
      expect(fs.readFileSync(result.envPath, 'utf8')).toContain('ASSURLY_CANARY_URL=');
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://assurly.dev/api/v1/canary',
        expect.objectContaining({ method: 'POST' }),
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
