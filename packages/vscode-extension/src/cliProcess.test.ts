import { describe, expect, it } from 'vitest';
import { createScanProcess } from './cliProcess';

describe('VS Code CLI process', () => {
  it('keeps an adversarial workspace path as one non-shell argument', () => {
    const process = createScanProcess('/extension', '/tmp/project; touch owned', '/node');
    expect(process.executable).toBe('/node');
    expect(process.args).toEqual([
      '/extension/vendor/shipready-cli.js',
      'scan',
      '--path',
      '/tmp/project; touch owned',
    ]);
    expect(process.options.cwd).toBe('/tmp/project; touch owned');
  });
});
