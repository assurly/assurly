#!/usr/bin/env node

/**
 * Verifies the dashboard Definition of Done (10/10) using automated gates.
 * Manual checklist: docs/qa/dashboard-manual-qa-checklist.md
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');

const checks = [];

function run(label, command, args) {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    stdio: 'pipe',
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const pass = result.status === 0;
  checks.push({
    label,
    pass,
    detail: pass ? 'pass' : (result.stderr || result.stdout || `exit ${result.status}`).trim(),
  });
  return pass;
}

function readMobilePerformanceScore() {
  const manifestPath = path.join(appRoot, '.perf-baseline/dashboard-manifest.json');
  const baselinePath = path.join(appRoot, '../../docs/baseline/2026-06-27-dashboard-perf-baseline.md');

  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const mobile = manifest.results?.find((entry) => entry.profile === 'mobile');
    if (mobile?.performanceScore !== undefined) {
      return mobile.performanceScore;
    }
  }

  if (existsSync(baselinePath)) {
    const match = readFileSync(baselinePath, 'utf8').match(/\| Mobile \| (\d+) \|/);
    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}

console.log('Dashboard DoD verification\n');

run(
  'Vitest dashboard + label/dedupe unit suite',
  'npx',
  [
    'vitest',
    'run',
    'src/app/dashboard',
    'src/utils/dashboardLabelCopy.test.ts',
    'src/utils/scanFindingsDisplay.test.ts',
  ],
);

run('Playwright dashboard mobile flows', 'npm', ['run', 'test:e2e:dashboard']);
run('Playwright dashboard QA gate (375/768/1280)', 'npm', ['run', 'test:e2e:qa-gate']);

const mobileScore = readMobilePerformanceScore();
const perfPass = mobileScore !== null && mobileScore >= 90;
checks.push({
  label: 'Lighthouse mobile performance score ≥ 90',
  pass: perfPass,
  detail: mobileScore === null ? 'missing baseline (run npm run perf:baseline)' : `score=${mobileScore}`,
});

const rg = spawnSync(
  'rg',
  [
    'style=\\{\\{',
    'src/app/dashboard/_components',
    '--glob',
    '*.tsx',
    '--glob',
    '!**/manual-checker/**',
    '-l',
  ],
  { cwd: appRoot, encoding: 'utf8' },
);
const inlineMatches = (rg.stdout || '').trim();
const inlineStylePass = inlineMatches.length === 0;
checks.push({
  label: 'Dashboard without inline styles (excluding manual-checker)',
  pass: inlineStylePass,
  detail: inlineStylePass ? 'pass' : `inline styles in: ${inlineMatches}`,
});

console.log('\nResults:\n');
let allPass = true;
for (const check of checks) {
  const status = check.pass ? 'PASS' : 'FAIL';
  console.log(`${status}  ${check.label} — ${check.detail}`);
  if (!check.pass) {
    allPass = false;
  }
}

if (!allPass) {
  process.exitCode = 1;
}
