import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { setupGitHubAction } from './ci';

const TEST_DIR = path.resolve(__dirname, '../test-fixtures-ci');

describe('GitHub Actions Integration Setup (ci)', () => {
  beforeAll(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should successfully create .github/workflows/assurly.yml file', () => {
    const result = setupGitHubAction(TEST_DIR);

    expect(result.success).toBe(true);
    expect(result.message).toContain('workflow successfully created');
    expect(result.filePath).toBeDefined();

    const expectedPath = path.join(TEST_DIR, '.github', 'workflows', 'assurly.yml');
    expect(fs.existsSync(expectedPath)).toBe(true);

    const content = fs.readFileSync(expectedPath, 'utf8');
    expect(content).toContain('name: Assurly Security & Config Scan');
    expect(content).toContain('npx --yes assurly@1 scan');
    // The scan is static analysis: no dependency install and no lockfile-bound
    // npm cache, so the workflow works on repos with package.json in a subdir.
    expect(content).not.toContain('npm ci');
    expect(content).not.toContain("cache: 'npm'");
  });

  it('should fail gracefully if writing to path is invalid', () => {
    const invalidPath = path.join(TEST_DIR, '.github', 'workflows', 'assurly.yml');
    // Ensure parent folders exist, then write a file
    const workflowsDir = path.dirname(invalidPath);
    if (!fs.existsSync(workflowsDir)) {
      fs.mkdirSync(workflowsDir, { recursive: true });
    }
    fs.writeFileSync(invalidPath, 'placeholder', 'utf8');

    // Passing a path under the file will fail because parent is a file
    const conflictPath = path.join(invalidPath, 'subfolder');
    const result = setupGitHubAction(conflictPath);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to create workflow file');
  });
});
