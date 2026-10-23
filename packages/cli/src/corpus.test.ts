import * as fs from 'fs';
import * as path from 'path';
import { findingKind } from '@assurly/scanner-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { scanProjectDirectory } from './scanProject';
import type { Finding } from './types';

/**
 * Precision gate. Every case under test-projects/corpus is a frozen project
 * beside a <case>.expected.json listing each real defect by rule, severity,
 * file and line. The answer sits outside the project so the scan never reads it. A finding the file does not list is a false positive; a listed one the
 * scan no longer reports is a missed defect. Either fails the build, so no rule
 * change can quietly trade one for the other. See test-projects/corpus/README.md.
 */

const CORPUS_ROOT = path.resolve(__dirname, '../../../test-projects/corpus');
/** Guards against a moved directory turning the gate into zero assertions. */
const MIN_CASES = 4;

const issueSchema = z
  .object({
    ruleId: z.string().min(1),
    severity: z.enum(['error', 'warning']),
    file: z.string().min(1).optional(),
    line: z.number().int().positive().optional(),
  })
  .strict();

const expectedSchema = z
  .object({
    description: z.string().min(1),
    origin: z.string().min(1),
    verdict: z
      .object({
        status: z.enum(['blocked', 'review', 'ready']),
        headline: z.string().min(1),
        shipScore: z.number().int().min(0).max(100),
        partialCoverage: z.boolean(),
      })
      .strict(),
    issues: z.array(issueSchema),
    /** Reported today, wrong, and tracked so the fix shows up as a diff here. */
    knownFalsePositives: z.array(issueSchema),
    coverage: z.array(z.string().min(1)),
    advisories: z.array(z.string().min(1)),
  })
  .strict();

type ExpectedIssue = z.infer<typeof issueSchema>;

function issueKey(issue: ExpectedIssue): string {
  return [issue.ruleId, issue.severity, issue.file ?? '-', issue.line ?? '-'].join(' · ');
}

function findingKey(finding: Finding): string {
  return issueKey({
    ruleId: finding.ruleId,
    severity: finding.severity === 'error' ? 'error' : 'warning',
    file: finding.file,
    line: finding.line,
  });
}

/** Multiset difference, so a duplicated finding counts as an extra one. */
function missingFrom(wanted: readonly string[], present: readonly string[]): string[] {
  const remaining = [...present];
  return wanted.filter((key) => {
    const index = remaining.indexOf(key);
    if (index === -1) return true;
    remaining.splice(index, 1);
    return false;
  });
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function expectedPath(name: string): string {
  return path.join(CORPUS_ROOT, `${name}.expected.json`);
}

const caseNames = fs
  .readdirSync(CORPUS_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe('precision corpus', () => {
  it(`holds at least ${MIN_CASES} cases, each with its expected answer`, () => {
    expect(caseNames.length).toBeGreaterThanOrEqual(MIN_CASES);
    for (const name of caseNames) {
      expect(fs.existsSync(expectedPath(name)), name).toBe(true);
    }
  });

  it.each(caseNames)('%s', async (name) => {
    const caseRoot = path.join(CORPUS_ROOT, name);
    const expected = expectedSchema.parse(JSON.parse(fs.readFileSync(expectedPath(name), 'utf8')));
    const { findings, report } = await scanProjectDirectory(caseRoot);

    const reported = findings.filter((finding) => findingKind(finding) === 'issue').map(findingKey);
    const listed = [...expected.issues, ...expected.knownFalsePositives].map(issueKey);

    // Named arrays, so a failure reads "falsePositives: [...]" rather than a raw diff.
    expect({
      falsePositives: missingFrom(reported, listed),
      missedDefects: missingFrom(expected.issues.map(issueKey), reported),
      fixedKnownFalsePositives: missingFrom(expected.knownFalsePositives.map(issueKey), reported),
    }).toEqual({ falsePositives: [], missedDefects: [], fixedKnownFalsePositives: [] });

    expect({
      status: report.status,
      headline: report.headline,
      shipScore: report.shipScore,
      partialCoverage: report.partialCoverage ?? false,
    }).toEqual(expected.verdict);

    const ruleIdsOfKind = (kind: 'coverage' | 'advisory'): string[] =>
      sortedUnique(
        findings.filter((finding) => findingKind(finding) === kind).map((f) => f.ruleId),
      );
    expect(ruleIdsOfKind('coverage')).toEqual(sortedUnique(expected.coverage));
    expect(ruleIdsOfKind('advisory')).toEqual(sortedUnique(expected.advisories));
  });
});
