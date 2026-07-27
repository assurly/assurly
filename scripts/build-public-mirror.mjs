#!/usr/bin/env node
/**
 * Assembles the public source mirror.
 *
 * The monorepo is private and stays that way: the hosted verdict API, the
 * dashboard, the fix-outcome corpus and the AI layer are the parts worth
 * protecting, and none of them live under `packages/`. What the mirror contains
 * is the code that is already public in readable form — every published tarball
 * ships unminified `tsc` output under MIT, so anyone can already read it with
 * `npm pack`. Publishing the source adds no exposure and buys npm provenance, a
 * GitHub presence, and the ability to say "read the rules" and mean it.
 *
 * This assembles rather than git-mirrors. A subtree split would carry history,
 * but the mirror needs a root manifest that does not exist in `packages/`, and
 * a generated tree is far easier to audit before it becomes irreversible — which
 * is the property that matters when the output is a public repository.
 *
 * Usage:
 *   node scripts/build-public-mirror.mjs [--out <dir>]
 *
 * Writes the tree and prints a manifest. It never pushes: publishing is a
 * separate, deliberate step.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Only these top-level entries are ever copied. Anything else is a bug.
 *
 * `test-projects` is here because two scanner-core integration tests read it. A
 * mirror whose test suite fails on checkout reads as a broken project, which is
 * the opposite of what publishing it is for.
 */
const MIRRORED_DIRS = ['packages', 'test-projects'];

/**
 * Filenames that must never reach a public repository, matched on the path.
 *
 * `.env.example`, `.env.sample` and `.env.template` are deliberately not here:
 * they carry variable names without values, are meant to be committed, and
 * Assurly's own `undocumented-env` rule complains when a project lacks one.
 * Treating them as secrets would flag the very file the scanner asks for.
 */
const FORBIDDEN_PATH =
  /(^|\/)(\.env(?!\.(example|sample|template)$)(\..*)?|.*\.pem|.*\.key|.*\.p12|id_rsa.*|\.npmrc)$/i;


/**
 * High-signal secret shapes. Deliberately narrow: a broad regex over a scanner's
 * own source matches its own rule patterns and cries wolf on every run.
 */
const SECRET_CONTENT = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key block'],
  [/\bnpm_[A-Za-z0-9]{36}\b/, 'npm access token'],
  [/\bgh[pousr]_[A-Za-z0-9]{36}\b/, 'GitHub token'],
  [/\bsk_live_[A-Za-z0-9]{20,}/, 'Stripe live key'],
  [/\bsk-ant-[A-Za-z0-9-]{20,}/, 'Anthropic key'],
];

/** Files whose contents are not worth scanning (binary, or generated bundles). */
const SKIP_CONTENT_SCAN = /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|zip|vsix|tgz)$/i;

/**
 * Test files are exempt from the content scan, and the count is reported so the
 * exemption is visible rather than silent.
 *
 * This project's tests necessarily contain credential-shaped fixtures, because
 * what they test is credential detection — `sk_live_…FakeSecretDoNotEcho`,
 * `sk-ant-…PlantedAnthropicKey`. Scanning them guarantees a hit on every run,
 * and a guard that always fires is a guard whoever runs it learns to wave
 * through. That is precisely the failure the scanner itself is built to avoid,
 * so the same discipline applies here: precision over exhaustiveness.
 *
 * The forbidden-filename check still covers these files, and a real credential
 * does not belong in a test in the first place.
 */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(fixtures|__tests__)\//i;

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(full, acc);
    } else if (entry.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

function readVersion(pkgRelPath) {
  return JSON.parse(readFileSync(join(REPO_ROOT, pkgRelPath), 'utf8')).version;
}

function rootPackageJson() {
  const engines = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).engines;
  return {
    name: 'assurly-packages',
    private: true,
    description:
      'Public source for the published Assurly packages: the scanner rules, the CLI, and the MCP server.',
    license: 'MIT',
    engines,
    workspaces: ['packages/*'],
    scripts: {
      build: 'npm run build -w packages/scanner-core && npm run build -w packages/cli && npm run build -w packages/mcp-server',
      test: 'npm test --workspaces --if-present',
    },
  };
}

function rootReadme() {
  const cli = readVersion('packages/cli/package.json');
  // The public repo's README is the highest-value crawlable artefact this
  // project has, so it answers the questions a reader actually arrives with
  // rather than restating the marketing.
  return `# Assurly — public source

Source for the published [Assurly](https://assurly.dev) packages. Assurly is a
pre-deploy ship gate for projects built with AI coding tools: it reads a
project's own files and returns one verdict — ready to ship, review, or blocked.

\`\`\`sh
npx assurly scan
\`\`\`

| Package | npm | What it is |
| --- | --- | --- |
| \`assurly\` | [npm](https://www.npmjs.com/package/assurly) | The CLI |
| \`@assurly/scanner-core\` | [npm](https://www.npmjs.com/package/@assurly/scanner-core) | The rule engine, browser-safe |
| \`@assurly/mcp-server\` | [npm](https://www.npmjs.com/package/@assurly/mcp-server) | MCP server for Cursor, Claude Code, VS Code, Windsurf |

Current release: **${cli}**

## What does it check?

Thirteen rule areas, all evaluated locally: Supabase row-level security, Stripe
webhook signature verification, secrets reaching client bundles, React Server
Component leaks, SQL migration safety, connection pooling, edge-runtime
compatibility, cold starts, TypeScript strictness, CI wiring, the agent's own
tooling, and install-time trust under npm 12.

## Which of my dependencies can run code when I install them?

\`\`\`sh
npx assurly scan --supply
\`\`\`

[npm 12 stopped running install scripts by default](https://github.blog/changelog/2026-06-09-upcoming-breaking-changes-for-npm-v12/),
so every project now records which dependencies it trusts to execute code during
installation. A bare name in that \`allowScripts\` allowlist grants execution to
every version of the package, forever — including one published later by whoever
takes it over. An exact pin does not. This reads that allowlist, the lockfile's
install-script flags, and non-registry dependencies, entirely offline.

## Can it check my AI agent's setup?

\`\`\`sh
npx assurly scan --agent
\`\`\`

It reads MCP client configuration and agent instruction files and reports servers
that run shell commands, remote endpoints on plain \`http://\`, credentials written
into config, and instructions hidden from readers but visible to models.

## Does my source code leave my machine?

No. Local scans run on your own hardware and make no network calls.

## About this repository

This is the public source for the published packages, mirrored from a private
monorepo that also holds the hosted service. It is read-only: issues and pull
requests opened here are not monitored. Report anything through
[assurly.dev](https://assurly.dev).

Licensed under MIT — see [LICENSE](./LICENSE).
`;
}

function main() {
  const outFlag = process.argv.indexOf('--out');
  const outDir = resolve(outFlag === -1 ? join(REPO_ROOT, '.public-mirror') : process.argv[outFlag + 1]);

  if (outDir === REPO_ROOT) throw new Error('Refusing to assemble into the repository root.');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // Copy what git tracks, not what happens to be on disk. Anything gitignored is
  // ignored for a reason — untracked `.env.local` files were sitting in
  // test-projects/ on the machine this was written on, and a directory copy
  // would have published them. Tracked contents are also what CI has, so a local
  // run and a workflow run produce the same tree.
  const tracked = execFileSync('git', ['ls-files', '-z', '--', ...MIRRORED_DIRS], { cwd: REPO_ROOT })
    .toString()
    .split('\0')
    .filter(Boolean);

  if (tracked.length === 0) throw new Error('git ls-files returned nothing — refusing to publish an empty mirror.');

  for (const rel of tracked) {
    const dest = join(outDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(REPO_ROOT, rel), dest);
  }

  writeFileSync(join(outDir, 'package.json'), `${JSON.stringify(rootPackageJson(), null, 2)}\n`);
  writeFileSync(join(outDir, 'README.md'), rootReadme());
  writeFileSync(join(outDir, 'LICENSE'), readFileSync(join(REPO_ROOT, 'LICENSE')));
  writeFileSync(join(outDir, '.gitignore'), 'node_modules/\n*.tgz\n*.vsix\n');

  // Audit what was assembled, not what was intended.
  const files = walk(outDir);
  const violations = [];
  let exemptTests = 0;
  for (const file of files) {
    const rel = relative(outDir, file);
    if (FORBIDDEN_PATH.test(rel)) violations.push(`${rel} — forbidden filename`);
    if (SKIP_CONTENT_SCAN.test(rel)) continue;
    if (TEST_FILE.test(rel)) {
      exemptTests += 1;
      continue;
    }
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const [pattern, label] of SECRET_CONTENT) {
      if (pattern.test(content)) violations.push(`${rel} — looks like a ${label}`);
    }
  }

  const bytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT }).toString().trim();

  console.log(`assembled ${files.length} files (${(bytes / 1024 / 1024).toFixed(1)} MB) into ${outDir}`);
  console.log(`source commit: ${sourceSha}`);
  console.log(`release: ${readVersion('packages/cli/package.json')}`);

  if (violations.length > 0) {
    console.error('\nrefusing to publish — the assembled tree contains:');
    for (const violation of violations) console.error(`  ${violation}`);
    process.exit(1);
  }
  console.log(
    `no forbidden filenames or credential-shaped content found ` +
      `(${exemptTests} test files exempt from the content scan — see TEST_FILE)`,
  );
}

main();
