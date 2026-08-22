import * as fs from 'fs';
import * as path from 'path';
import { mergeCanaryPlantIntoEnvExample } from '@assurly/scanner-core';

export interface PlantCanaryCliOptions {
  projectPath: string;
  repo: string;
  apiKey: string;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
}

export async function plantCanaryLocally(options: PlantCanaryCliOptions): Promise<{
  envPath: string;
  changed: boolean;
  callbackUrl?: string;
}> {
  const base = options.apiBaseUrl.replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${base}/api/v1/canary`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({ repo: options.repo }),
  });

  const payload = (await response.json().catch(() => null)) as {
    snippet?: string;
    callbackUrl?: string;
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && payload.error?.message
        ? payload.error.message
        : `Plant failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  const snippet = payload?.snippet?.trim() ?? '';
  if (!snippet) {
    throw new Error('The Assurly API did not return a plant snippet.');
  }

  const envPath = path.join(path.resolve(options.projectPath), '.env.example');
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const merged = mergeCanaryPlantIntoEnvExample(existing, snippet);
  if (merged.changed) {
    fs.writeFileSync(envPath, merged.content, 'utf8');
  }

  return { envPath, changed: merged.changed, callbackUrl: payload?.callbackUrl };
}
