import * as fs from 'fs';
import * as path from 'path';
import { scanEnvVariables } from '@shipready/scanner-core';
import { Rule, ProjectContext, Finding } from '../types';

/**
 * Parses a standard key-value .env file format.
 * Verified by unit tests.
 */
function parseEnvFile(filePath: string): Set<string> {
  const keys = new Set<string>();
  if (!fs.existsSync(filePath)) {
    return keys;
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const match = trimmed.match(/^([^=]+)=/);
      if (match) {
        keys.add(match[1].trim());
      }
    }
  } catch (e) {
    // Ignore read errors
  }
  return keys;
}

export const envRules: Rule = {
  id: 'env-vars-validator',
  name: 'Environment Variables Validation',
  description:
    'Verifies env file consistency and checks for undocumented environment variables in the codebase.',
  severity: 'error',

  async run(context: ProjectContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    const rootPath = context.projectPath;

    const examplePath = path.join(rootPath, '.env.example');
    const hasExample = fs.existsSync(examplePath);

    if (!hasExample) {
      findings.push({
        ruleId: this.id,
        severity: 'warning',
        message:
          'No .env.example file found at the root of the project. It is highly recommended to document your environment variables.',
      });
      return findings;
    }

    // Parse keys from .env.example
    const exampleKeys = parseEnvFile(examplePath);

    // Find local environment files (.env, .env.local, .env.development)
    const localEnvFiles = ['.env.local', '.env.development', '.env'];
    let localKeys = new Set<string>();
    let foundLocalFile = '';

    for (const file of localEnvFiles) {
      const fullPath = path.join(rootPath, file);
      if (fs.existsSync(fullPath)) {
        localKeys = parseEnvFile(fullPath);
        foundLocalFile = file;
        break;
      }
    }

    // Rule 1: Check if any key from .env.example is missing in local .env configuration
    for (const key of exampleKeys) {
      if (foundLocalFile && !localKeys.has(key)) {
        findings.push({
          ruleId: this.id,
          severity: 'warning',
          file: foundLocalFile,
          message: `Environment variable '${key}' (declared in .env.example) is not defined in your local '${foundLocalFile}' file.`,
          suggestion: `Add placeholder: ${key}=your_value`,
        });
      }
    }

    const exampleContent = fs.readFileSync(examplePath, 'utf8');
    findings.push(...scanEnvVariables(exampleContent, '', '.env.example', 'code.ts').findings);
    const srcFiles = context.files.filter(
      (f) =>
        (f.startsWith('src/') ||
          f.startsWith('app/') ||
          f.startsWith('pages/') ||
          f.startsWith('components/')) &&
        /\.(js|ts|jsx|tsx)$/.test(f),
    );

    for (const file of srcFiles) {
      try {
        const fullPath = path.join(rootPath, file);
        const content = fs.readFileSync(fullPath, 'utf8');
        findings.push(
          ...scanEnvVariables(exampleContent, content, '.env.example', file).findings.filter(
            (finding) => finding.ruleId === 'undocumented-env',
          ),
        );
      } catch (e) {
        // Ignore read errors
      }
    }

    return findings;
  },
};
