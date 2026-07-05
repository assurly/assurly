import * as fs from 'fs';
import * as path from 'path';
import {
  collectTestOnlyEnvKeys,
  scanEnvVariables,
  type SourceInput,
} from '@shipready/scanner-core';
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
  } catch {
    // Ignore read errors
  }
  return keys;
}

function readFileContent(rootPath: string, relativePath: string): string | null {
  try {
    return fs.readFileSync(path.join(rootPath, relativePath), 'utf8');
  } catch {
    return null;
  }
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

    const examplePaths = context.files.filter((file) => file.endsWith('.env.example'));
    if (examplePaths.length === 0) {
      findings.push({
        ruleId: this.id,
        severity: 'warning',
        message:
          'No .env.example file found at the root of the project. It is highly recommended to document your environment variables.',
      });
      return findings;
    }

    const allExamples: SourceInput[] = examplePaths.flatMap((file) => {
      const content = readFileContent(rootPath, file);
      return content ? [{ file, content }] : [];
    });

    const rootExamplePath = examplePaths.includes('.env.example')
      ? '.env.example'
      : examplePaths[0];
    const rootExampleContent = readFileContent(rootPath, rootExamplePath) ?? '';

    // Parse keys from root .env.example for local env consistency check
    const exampleKeys = parseEnvFile(path.join(rootPath, rootExamplePath));

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

    findings.push(
      ...scanEnvVariables(rootExampleContent, '', rootExamplePath, 'code.ts', {
        allExamples,
      }).findings,
    );

    const codeSources: SourceInput[] = [];
    const srcFiles = context.files.filter(
      (file) =>
        (file.startsWith('src/') ||
          file.startsWith('app/') ||
          file.startsWith('apps/') ||
          file.startsWith('pages/') ||
          file.startsWith('components/')) &&
        /\.(js|ts|jsx|tsx)$/.test(file),
    );

    for (const file of srcFiles) {
      const content = readFileContent(rootPath, file);
      if (content) codeSources.push({ file, content });
    }

    const testOnlyKeys = collectTestOnlyEnvKeys([
      ...codeSources,
      ...context.files
        .filter(
          (file) => /\.(js|ts|jsx|tsx)$/.test(file) && !codeSources.some((s) => s.file === file),
        )
        .flatMap((file) => {
          const content = readFileContent(rootPath, file);
          return content ? [{ file, content }] : [];
        }),
    ]);

    for (const source of codeSources) {
      findings.push(
        ...scanEnvVariables(rootExampleContent, source.content, rootExamplePath, source.file, {
          allExamples,
          testOnlyKeys,
        }).findings.filter((finding) => finding.ruleId === 'undocumented-env'),
      );
    }

    return findings;
  },
};
