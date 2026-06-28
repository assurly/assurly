import * as fs from 'fs';
import * as path from 'path';
import { Rule, ProjectContext, Finding } from '../types';

/**
 * Strips single-line and multi-line comments from JSON string.
 */
function stripJsonComments(jsonString: string): string {
  return jsonString.replace(/("([^"\\]|\\.)*")|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? m : ''));
}

/**
 * Rule to check if strict mode is enabled in tsconfig.json.
 */
export const tsconfigRules: Rule = {
  id: 'typescript-strict-mode',
  name: 'TypeScript Strict Mode Validation',
  description:
    'Ensures compilerOptions.strict is set to true in tsconfig.json to enforce maximum type safety.',
  severity: 'warning',

  async run(context: ProjectContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    const tsconfigPath = 'tsconfig.json';
    const fullPath = path.join(context.projectPath, tsconfigPath);

    const hasTsconfig = context.files.includes(tsconfigPath) || fs.existsSync(fullPath);

    if (!hasTsconfig) {
      findings.push({
        ruleId: this.id,
        severity: 'warning',
        message:
          'No tsconfig.json file found in project root. TypeScript configuration is missing.',
        suggestion:
          'Create a tsconfig.json in the project root and configure "strict": true in compilerOptions.',
      });
      return findings;
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const cleanContent = stripJsonComments(content);
      const parsed = JSON.parse(cleanContent);

      const strictEnabled = parsed?.compilerOptions?.strict === true;

      if (!strictEnabled) {
        findings.push({
          ruleId: this.id,
          severity: 'warning',
          file: tsconfigPath,
          message:
            'TypeScript strict mode is disabled or not set. "strict": true is highly recommended for B2B SaaS applications to prevent runtime crashes.',
          suggestion:
            'Set "strict": true inside the "compilerOptions" block of your tsconfig.json.',
        });
      }
    } catch (error: any) {
      findings.push({
        ruleId: this.id,
        severity: 'warning',
        file: tsconfigPath,
        message: `Failed to parse tsconfig.json: ${error.message || error}.`,
        suggestion: 'Verify that tsconfig.json is a valid JSON file (with or without comments).',
      });
    }

    return findings;
  },
};
