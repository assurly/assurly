import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISCLOSURE_CONTACT_PATH, disclosureContactUrl } from './disclosureContact';
import { CONTACT_SUBJECT_PARAM } from './contactSubjects';

const REPO_ROOT = resolve(__dirname, '../../../..');

describe('CRA / CVD contact path consistency', () => {
  it('exposes the canonical Trust & Security intake path', () => {
    expect(DISCLOSURE_CONTACT_PATH).toBe(`/?${CONTACT_SUBJECT_PARAM}=trust#contact`);
    expect(disclosureContactUrl('https://assurly.dev')).toBe(
      'https://assurly.dev/?subject=trust#contact',
    );
  });

  it('security.txt route uses disclosureContactUrl', () => {
    const source = readFileSync(
      resolve(__dirname, '../app/.well-known/security.txt/route.ts'),
      'utf8',
    );
    expect(source).toContain('disclosureContactUrl');
    expect(source).not.toMatch(/Contact: \$\{appUrl\}\/\?subject=/);
  });

  it('Trust page §13 links the same subject=trust contact intake', () => {
    const source = readFileSync(resolve(__dirname, '../app/trust/page.tsx'), 'utf8');
    expect(source).toContain('DISCLOSURE_CONTACT_PATH');
    expect(source).toContain('/.well-known/security.txt');
    expect(source).toMatch(/13\.\s*Reporting a vulnerability|13\.1 How to report/);
  });

  it('CRA reporting runbook documents the same contact path', () => {
    const runbook = readFileSync(
      resolve(REPO_ROOT, 'docs/runbooks/cra-actively-exploited-vulnerability-reporting.md'),
      'utf8',
    );
    expect(runbook).toContain('/?subject=trust#contact');
    expect(runbook).toContain('security.txt');
    expect(runbook).toContain('Trust page §13');
  });
});
