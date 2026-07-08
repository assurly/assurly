import * as fs from 'fs';
import * as path from 'path';
import { Rule, ProjectContext, Finding } from '../types';

const WORKFLOW_PATTERN = /^\.github\/workflows\/.*\.(ya?ml)$/i;
const SCAN_STEP_PATTERN = /assurly|npm\s+run\s+scan(?::self)?|npx\s+assurly\s+scan/i;

function workflowRunsScanStep(content: string): boolean {
  return SCAN_STEP_PATTERN.test(content);
}

/**
 * CI/CD Rule — hints when no workflow runs an Assurly scan; never blocks.
 */
export const ciRules: Rule = {
  id: 'github-actions-integration',
  name: 'GitHub Actions CI/CD Integration',
  description:
    'Ensures the project is configured with a GitHub Actions workflow for automatic Assurly scans.',
  severity: 'warning',

  async run(context: ProjectContext): Promise<Finding[]> {
    const workflowFiles = context.files.filter((file) =>
      WORKFLOW_PATTERN.test(file.replace(/\\/g, '/')),
    );

    for (const workflowFile of workflowFiles) {
      try {
        const content = fs.readFileSync(path.join(context.projectPath, workflowFile), 'utf8');
        if (workflowRunsScanStep(content)) {
          return [];
        }
      } catch {
        // Ignore unreadable workflow files and keep checking others.
      }
    }

    return [
      {
        ruleId: this.id,
        severity: 'warning',
        message: 'GitHub Actions workflow for Assurly is missing.',
        suggestion:
          'Run "npx assurly init" to automatically generate the .github/workflows/assurly.yml workflow file.',
      },
    ];
  },
};
