#!/usr/bin/env node

/**
 * Runs Lighthouse performance audits against /dashboard (mobile + desktop).
 * Expects a production server already listening on PERF_BASE_URL (default http://127.0.0.1:3000).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');

const BASE_URL = process.env.PERF_BASE_URL ?? 'http://127.0.0.1:3000';
const TARGET_PATH = process.env.PERF_TARGET_PATH ?? '/dashboard';
const TARGET_URL = new URL(TARGET_PATH, BASE_URL).toString();
const OUTPUT_DIR = process.env.PERF_OUTPUT_DIR ?? path.join(appRoot, '.perf-baseline');

const THRESHOLDS = {
  lcpMs: Number(process.env.PERF_LCP_MS ?? 2500),
  cls: Number(process.env.PERF_CLS ?? 0.1),
  inpMs: Number(process.env.PERF_INP_MS ?? 200),
};

const PROFILES = [
  {
    id: 'mobile',
    label: 'Mobile',
    config: {
      extends: 'lighthouse:default',
      settings: {
        formFactor: 'mobile',
        screenEmulation: {
          mobile: true,
          width: 375,
          height: 812,
          deviceScaleFactor: 2,
          disabled: false,
        },
        throttling: {
          rttMs: 150,
          throughputKbps: 1638.4,
          cpuSlowdownMultiplier: 4,
          requestLatencyMs: 150,
          downloadThroughputKbps: 1638.4,
          uploadThroughputKbps: 675,
        },
      },
    },
  },
  {
    id: 'desktop',
    label: 'Desktop',
    config: {
      extends: 'lighthouse:default',
      settings: {
        formFactor: 'desktop',
        screenEmulation: {
          mobile: false,
          width: 1350,
          height: 940,
          deviceScaleFactor: 1,
          disabled: false,
        },
        throttling: {
          rttMs: 40,
          throughputKbps: 10240,
          cpuSlowdownMultiplier: 1,
          requestLatencyMs: 0,
          downloadThroughputKbps: 10240,
          uploadThroughputKbps: 10240,
        },
      },
    },
  },
];

function readMetric(audits, ids) {
  for (const id of ids) {
    const audit = audits[id];
    if (audit?.numericValue !== undefined && audit.numericValue !== null) {
      return {
        id,
        value: audit.numericValue,
        display: audit.displayValue ?? String(audit.numericValue),
        score: audit.score,
      };
    }
  }
  return null;
}

function evaluateMetric(metric, threshold, { optional = false } = {}) {
  if (!metric) {
    return { pass: optional, reason: optional ? 'skipped' : 'missing' };
  }
  const pass = metric.value <= threshold;
  return { pass, reason: pass ? 'ok' : 'threshold' };
}

function formatMs(value) {
  return `${Math.round(value)} ms`;
}

function extractLcpElement(audits) {
  const insightItems = audits['lcp-breakdown-insight']?.details?.items;
  const nodeItem = insightItems?.find((item) => item.type === 'node');
  if (nodeItem?.nodeLabel) {
    return {
      label: nodeItem.nodeLabel,
      selector: nodeItem.selector ?? null,
    };
  }

  const fallbackNode = audits['largest-contentful-paint-element']?.details?.items?.[0]?.node;
  if (fallbackNode?.nodeLabel) {
    return {
      label: fallbackNode.nodeLabel,
      selector: fallbackNode.selector ?? null,
    };
  }

  return null;
}

function extractOpportunities(audits) {
  const ids = [
    'render-blocking-resources',
    'unused-javascript',
    'unused-css-rules',
    'modern-image-formats',
    'font-display',
    'server-response-time',
  ];

  return ids
    .map((id) => audits[id])
    .filter((audit) => audit && audit.score !== null && audit.score < 1)
    .map((audit) => ({
      id: audit.id,
      title: audit.title,
      display: audit.displayValue ?? '',
      savingsMs: audit.details?.overallSavingsMs ?? null,
    }))
    .slice(0, 5);
}

async function runProfile(profile) {
  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu'],
  });

  try {
    const runnerResult = await lighthouse(TARGET_URL, {
      port: chrome.port,
      output: ['json', 'html'],
      logLevel: 'error',
      onlyCategories: ['performance'],
    }, profile.config);

    const lhr = runnerResult.lhr;
    const audits = lhr.audits;

    const lcp = readMetric(audits, ['largest-contentful-paint']);
    const cls = readMetric(audits, ['cumulative-layout-shift']);
    const inp = readMetric(audits, [
      'interaction-to-next-paint',
      'experimental-interaction-to-next-paint',
    ]);
    const tbt = readMetric(audits, ['total-blocking-time']);
    const fcp = readMetric(audits, ['first-contentful-paint']);
    const performanceScore = Math.round((lhr.categories.performance?.score ?? 0) * 100);

    const checks = {
      lcp: evaluateMetric(lcp, THRESHOLDS.lcpMs),
      cls: evaluateMetric(cls, THRESHOLDS.cls),
      inp: evaluateMetric(inp, THRESHOLDS.inpMs, { optional: true }),
    };

    const pass = checks.lcp.pass && checks.cls.pass && checks.inp.pass;
    const lcpElement = extractLcpElement(audits);
    const opportunities = extractOpportunities(audits);

    await mkdir(OUTPUT_DIR, { recursive: true });
    const jsonPath = path.join(OUTPUT_DIR, `dashboard-${profile.id}.json`);
    const htmlPath = path.join(OUTPUT_DIR, `dashboard-${profile.id}.html`);
    await writeFile(jsonPath, runnerResult.report[0], 'utf8');
    await writeFile(htmlPath, runnerResult.report[1], 'utf8');

    return {
      profile: profile.id,
      label: profile.label,
      url: TARGET_URL,
      performanceScore,
      metrics: {
        lcp,
        cls,
        inp,
        tbt,
        fcp,
      },
      checks,
      pass,
      lcpElement,
      opportunities,
      finalUrl: lhr.finalUrl,
      artifacts: { jsonPath, htmlPath },
    };
  } finally {
    await chrome.kill();
  }
}

function renderMarkdownReport(results, generatedAt) {
  const lines = [
    '# Dashboard production performance baseline',
    '',
    `- Generated: ${generatedAt}`,
    `- Target: \`${TARGET_URL}\``,
    `- Thresholds: LCP < ${THRESHOLDS.lcpMs} ms, CLS < ${THRESHOLDS.cls}, INP < ${THRESHOLDS.inpMs} ms (lab INP when available)`,
    '',
    '## How to reproduce',
    '',
    '```bash',
    'cd apps/web',
    'npm run perf:baseline',
    '```',
    '',
    'The script runs `next build`, starts `next start` on `127.0.0.1:3000`, then audits `/dashboard` with Lighthouse mobile (375px) and desktop profiles. Reports land in `apps/web/.perf-baseline/` and this file is refreshed automatically.',
    '',
    '## Summary',
    '',
    '| Profile | Performance | LCP | CLS | INP | Gate |',
    '| ------- | ----------- | --- | --- | --- | ---- |',
  ];

  for (const result of results) {
    const lcpText = result.metrics.lcp ? formatMs(result.metrics.lcp.value) : 'n/a';
    const clsText = result.metrics.cls ? result.metrics.cls.display : 'n/a';
    const inpText = result.metrics.inp ? formatMs(result.metrics.inp.value) : 'n/a (lab)';
    const gate = result.pass ? 'PASS' : 'FAIL';
    lines.push(
      `| ${result.label} | ${result.performanceScore} | ${lcpText} | ${clsText} | ${inpText} | ${gate} |`,
    );
  }

  lines.push('', '## Interpretation', '');
  lines.push(
    '- **Performance score ≥ 90 (mobile)** is the product DoD target from Fáza 5.3; raw Core Web Vitals thresholds below are the engineering gate for this baseline script.',
  );
  lines.push(
    '- **INP** is often unavailable in lab mode; TBT is included below as a proxy until field INP or user-flow Lighthouse runs are added.',
  );

  lines.push('', '## Findings', '');

  for (const result of results) {
    lines.push(`### ${result.label}`, '');
    lines.push(`- Final URL: \`${result.finalUrl}\``);
    if (result.lcpElement) {
      lines.push(`- LCP element: “${result.lcpElement.label}”`);
      if (result.lcpElement.selector) {
        lines.push(`- LCP selector: \`${result.lcpElement.selector}\``);
      }
    }
    if (result.opportunities.length > 0) {
      lines.push('- Top opportunities:');
      for (const opportunity of result.opportunities) {
        const savings =
          opportunity.savingsMs !== null ? ` (~${Math.round(opportunity.savingsMs)} ms)` : '';
        lines.push(`  - ${opportunity.title}: ${opportunity.display}${savings}`);
      }
    } else {
      lines.push('- Top opportunities: none flagged');
    }
    lines.push('');
  }

  lines.push('## Notes', '');
  lines.push(
    '- Audits run against `npm run build` + `npm run start` (production bundle), not `next dev`.',
  );
  lines.push(
    '- `/dashboard` is measured on the unauthenticated gate view during local baseline runs (`PERF_BASELINE=1` bypasses the auth redirect on localhost only). Re-run with a real session cookie to capture the signed-in dashboard.',
  );
  lines.push(
    '- INP is only reported when Lighthouse exposes an lab INP audit; otherwise use TBT + manual interaction QA.',
  );
  lines.push('', '## Artifacts', '');

  for (const result of results) {
    lines.push(`- ${result.label}: \`${path.relative(appRoot, result.artifacts.jsonPath)}\`, \`${path.relative(appRoot, result.artifacts.htmlPath)}\``);
  }

  lines.push('', '## Raw metrics', '');

  for (const result of results) {
    lines.push(`### ${result.label}`, '');
    if (result.metrics.fcp) {
      lines.push(`- FCP: ${formatMs(result.metrics.fcp.value)}`);
    }
    if (result.metrics.tbt) {
      lines.push(`- TBT: ${formatMs(result.metrics.tbt.value)}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  console.log(`Lighthouse baseline → ${TARGET_URL}`);
  const results = [];

  for (const profile of PROFILES) {
    console.log(`Running ${profile.label} profile…`);
    const result = await runProfile(profile);
    results.push(result);
    console.log(
      `${profile.label}: score=${result.performanceScore}, LCP=${result.metrics.lcp ? formatMs(result.metrics.lcp.value) : 'n/a'}, CLS=${result.metrics.cls?.display ?? 'n/a'}, INP=${result.metrics.inp ? formatMs(result.metrics.inp.value) : 'n/a'}`,
    );
  }

  const generatedAt = new Date().toISOString();
  const markdown = renderMarkdownReport(results, generatedAt);
  const summaryPath = path.join(OUTPUT_DIR, 'dashboard-summary.md');
  await writeFile(summaryPath, markdown, 'utf8');

  const repoBaselinePath = path.resolve(
    appRoot,
    '../../docs/baseline/2026-06-27-dashboard-perf-baseline.md',
  );
  await writeFile(repoBaselinePath, markdown, 'utf8');

  const manifest = {
    generatedAt,
    targetUrl: TARGET_URL,
    thresholds: THRESHOLDS,
    results,
  };
  await writeFile(path.join(OUTPUT_DIR, 'dashboard-manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`Summary written to ${summaryPath}`);
  console.log(`Committed baseline copy: ${repoBaselinePath}`);

  const failed = results.filter((result) => !result.pass);
  if (failed.length > 0) {
    console.error(`Perf gate failed for: ${failed.map((result) => result.label).join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
