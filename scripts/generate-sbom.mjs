#!/usr/bin/env node
/**
 * Generate CycloneDX SBOMs for published Assurly npm packages.
 *
 * Machine-generated — do not hand-edit files under sbom/. Re-run after
 * dependency or version changes:
 *
 *   npm run sbom:published
 *
 * Uses `npm sbom` (npm 10+) so the lockfile is the source of truth.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'sbom');

/** Workspaces we place on npm (see docs/cra-scope-assessment.md). */
const PUBLISHED_WORKSPACES = [
  { workspace: 'packages/scanner-core', outName: 'assurly-scanner-core.cdx.json' },
  { workspace: 'packages/cli', outName: 'assurly-cli.cdx.json' },
  { workspace: 'packages/mcp-server', outName: 'assurly-mcp-server.cdx.json' },
];

function packageName(workspaceDir) {
  const pkg = JSON.parse(readFileSync(join(ROOT, workspaceDir, 'package.json'), 'utf8'));
  return { name: pkg.name, version: pkg.version };
}

function generateOne(workspace, outName) {
  const result = spawnSync(
    'npm',
    [
      'sbom',
      '--sbom-format',
      'cyclonedx',
      '--package-lock-only',
      '--omit',
      'dev',
      '-w',
      workspace,
    ],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    throw new Error(`npm sbom failed for ${workspace} (exit ${result.status})`);
  }

  const sbom = JSON.parse(result.stdout);
  const meta = packageName(workspace);
  // Annotate so consumers can see which Assurly product this bill describes.
  sbom.metadata = sbom.metadata ?? {};
  sbom.metadata.component = {
    ...(sbom.metadata.component ?? {}),
    type: 'library',
    name: meta.name,
    version: meta.version,
  };
  sbom.metadata.properties = [
    ...(Array.isArray(sbom.metadata.properties) ? sbom.metadata.properties : []),
    { name: 'assurly:sbom-generated-by', value: 'scripts/generate-sbom.mjs' },
    { name: 'assurly:workspace', value: workspace },
  ];

  const outPath = join(OUT_DIR, outName);
  writeFileSync(outPath, `${JSON.stringify(sbom, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${outPath} (${meta.name}@${meta.version})`);
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  if (!existsSync(join(ROOT, 'package-lock.json'))) {
    throw new Error('package-lock.json is required (npm sbom --package-lock-only).');
  }
  for (const entry of PUBLISHED_WORKSPACES) {
    generateOne(entry.workspace, entry.outName);
  }
}

main();
