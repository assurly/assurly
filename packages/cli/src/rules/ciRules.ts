import * as fs from 'fs';
import * as path from 'path';
import { Rule, ProjectContext, Finding } from '../types';

/**
 * CI/CD Rule to verify if the project has the GitHub Actions integration set up.
 */
export const ciRules: Rule = {
  id: 'github-actions-cicd',
  name: 'GitHub Actions CI/CD Integration',
  description:
    'Ensures the project is configured with a GitHub Actions workflow for automatic ShipReady scans.',
  severity: 'warning',

  async run(context: ProjectContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    const workflowPath = path.join('.github', 'workflows', 'shipready.yml');

    // Normalize slashes for cross-platform matching in context.files
    const hasWorkflowInContext = context.files.some((file) => {
      const normalized = file.replace(/\\/g, '/');
      return normalized === '.github/workflows/shipready.yml';
    });

    // Fallback: direct filesystem check
    const hasWorkflowOnFile = fs.existsSync(path.join(context.projectPath, workflowPath));

    if (!hasWorkflowInContext && !hasWorkflowOnFile) {
      findings.push({
        ruleId: this.id,
        severity: 'warning',
        message: 'GitHub Actions workflow for ShipReady is missing.',
        suggestion:
          'Run "npx shipready init" to automatically generate the .github/workflows/shipready.yml workflow file.',
      });
    }

    return findings;
  },
};
