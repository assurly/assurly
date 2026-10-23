import {
  languageCoveragePaths,
  SCAN_LANGUAGE_COVERAGE_RULE_ID,
  summarizeUnanalyzedSource,
  unanalyzedSourceFinding,
} from '@assurly/scanner-core';
import { Rule, Finding, ProjectContext } from '../types';

/**
 * Payment or login code in a language Assurly cannot read. The dashboard has
 * always said so; the CLI did not, so it called Attesta (Go backend with
 * Stripe and auth) "REVIEW RECOMMENDED 92" where the dashboard said "CAN'T
 * CALL IT YET". Same files, same verdict, whichever channel ran the scan.
 */
export const languageCoverageRules: Rule = {
  id: SCAN_LANGUAGE_COVERAGE_RULE_ID,
  name: 'Unread Language Coverage',
  description: 'Reports payment and authentication code in languages the rules cannot read.',
  severity: 'warning',

  async run(context: ProjectContext): Promise<Finding[]> {
    const paths = languageCoveragePaths(context.files);
    const finding = unanalyzedSourceFinding(summarizeUnanalyzedSource(paths));
    return finding ? [finding] : [];
  },
};
