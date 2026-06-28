#!/usr/bin/env node

/**
 * End-to-end production perf baseline:
 * 1) next build
 * 2) next start on PERF_PORT
 * 3) Lighthouse mobile + desktop on /dashboard
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');

const HOST = process.env.PERF_HOST ?? '127.0.0.1';
const PORT = Number(process.env.PERF_PORT ?? 3000);
const BASE_URL = `http://${HOST}:${PORT}`;

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: appRoot,
      stdio: 'inherit',
      env: { ...process.env, ...options.env },
      shell: process.platform === 'win32',
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function waitForServer(url, timeoutMs = 120_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok || response.status === 307 || response.status === 308) {
        return;
      }
    } catch {
      // Server not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  console.log('Step 1/3: production build');
  await runCommand('npm', ['run', 'build']);

  console.log(`Step 2/3: starting production server on ${BASE_URL}`);
  const server = spawn('npm', ['run', 'start', '--', '--hostname', HOST, '--port', String(PORT)], {
    cwd: appRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      APP_URL: BASE_URL,
      PERF_BASELINE: '1',
    },
    shell: process.platform === 'win32',
  });

  server.stdout.on('data', (chunk) => process.stdout.write(chunk));
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));

  try {
    await waitForServer(`${BASE_URL}/dashboard`);
    console.log('Server ready.');

    console.log('Step 3/3: Lighthouse mobile + desktop on /dashboard');
    await runCommand('node', [path.join(__dirname, 'lighthouse-dashboard.mjs')], {
      env: {
        PERF_BASE_URL: BASE_URL,
        PERF_TARGET_PATH: '/dashboard',
      },
    });
  } finally {
    server.kill('SIGTERM');
    await Promise.race([
      once(server, 'close'),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
