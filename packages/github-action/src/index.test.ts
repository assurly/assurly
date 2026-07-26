import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as core from './runtime';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import { ASSURLY_CLI_PACKAGE_SPEC, run } from './index';

vi.mock('./runtime', () => {
  const summaryMock = {
    addHeading: vi.fn().mockReturnThis(),
    addRaw: vi.fn().mockReturnThis(),
    addTable: vi.fn().mockReturnThis(),
    write: vi.fn().mockResolvedValue({}),
  };
  return {
    getInput: vi.fn(),
    setOutput: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    setFailed: vi.fn(),
    summary: summaryMock,
  };
});

vi.mock('@actions/exec', () => {
  return {
    exec: vi.fn(),
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

describe('Assurly GitHub Action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pins the CLI package version to packages/cli/package.json', () => {
    const cliVersion = (
      JSON.parse(readFileSync(new URL('../../cli/package.json', import.meta.url), 'utf8')) as {
        version: string;
      }
    ).version;
    expect(ASSURLY_CLI_PACKAGE_SPEC).toBe(`assurly@${cliVersion}`);
  });

  it('runs npx assurly when no custom cli-path is provided and succeeds with no findings', async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === 'path') return '.';
      return '';
    });

    vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
      if (options?.listeners?.stdout) {
        options.listeners.stdout(Buffer.from('[]'));
      }
      return 0; // Success
    });

    await run();

    expect(core.getInput).toHaveBeenCalledWith('path');
    expect(exec.exec).toHaveBeenCalledWith(
      'npx',
      ['--yes', ASSURLY_CLI_PACKAGE_SPEC, 'scan', '--json', '--path', expect.any(String)],
      expect.any(Object),
    );
    expect(core.setOutput).toHaveBeenCalledWith('findings-count', '0');
    expect(core.setOutput).toHaveBeenCalledWith('errors-count', '0');
    expect(core.setOutput).toHaveBeenCalledWith('warnings-count', '0');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('runs node with custom cli-path when provided, processes warnings and errors, and sets action to failed', async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === 'path') return 'custom-path';
      if (name === 'cli-path') return 'path/to/cli.js';
      return '';
    });

    vi.mocked(fs.existsSync).mockReturnValue(true);

    const mockFindings = [
      {
        ruleId: 'env-secrets',
        severity: 'error',
        file: '.env.local',
        line: 5,
        message: 'CRITICAL SECURITY RISK: Service role key prefix leak.',
        suggestion: 'Remove NEXT_PUBLIC_',
      },
      {
        ruleId: 'tsconfig-strict',
        severity: 'warning',
        file: 'tsconfig.json',
        message: 'Strict typechecking is disabled.',
        suggestion: 'Set strict: true',
      },
    ];

    vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
      if (options?.listeners?.stdout) {
        options.listeners.stdout(Buffer.from(JSON.stringify(mockFindings)));
      }
      return 1; // Scan failed (had errors)
    });

    await run();

    expect(exec.exec).toHaveBeenCalledWith(
      'node',
      [expect.stringContaining('path/to/cli.js'), 'scan', '--json', '--path', expect.any(String)],
      expect.any(Object),
    );

    // Verify outputs
    expect(core.setOutput).toHaveBeenCalledWith('findings-count', '2');
    expect(core.setOutput).toHaveBeenCalledWith('errors-count', '1');
    expect(core.setOutput).toHaveBeenCalledWith('warnings-count', '1');

    // Verify annotations
    expect(core.error).toHaveBeenCalledWith(
      expect.stringContaining('CRITICAL SECURITY RISK: Service role key prefix leak.'),
      expect.objectContaining({
        title: 'Assurly: env-secrets',
        startLine: 5,
      }),
    );

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Strict typechecking is disabled.'),
      expect.objectContaining({
        title: 'Assurly: tsconfig-strict',
      }),
    );

    // Verify that the build is set to failed due to the critical error
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Assurly scan failed with 1 critical error(s).'),
    );
  });

  it('sets action status to failed when command execution crashes', async () => {
    vi.mocked(core.getInput).mockImplementation(() => '');

    vi.mocked(exec.exec).mockResolvedValue(127); // Command not found / failed

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('CLI execution failed with exit code 127'),
    );
  });
});
