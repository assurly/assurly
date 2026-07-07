import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { error, setOutput } from './runtime';

describe('GitHub workflow runtime', () => {
  afterEach(() => {
    delete process.env.GITHUB_OUTPUT;
    vi.restoreAllMocks();
  });

  it('writes multiline outputs without workflow-file injection', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'assurly-action-'));
    const output = path.join(directory, 'output');
    process.env.GITHUB_OUTPUT = output;
    setOutput('findings-count', '1\nforged=1');
    const value = fs.readFileSync(output, 'utf8');
    expect(value).toMatch(/^findings-count<<assurly_/);
    expect(value).toContain('\n1\nforged=1\nassurly_');
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('escapes workflow command payloads and annotation properties', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    error('line 1\nline 2', { file: 'x,y.ts', startLine: 1 });
    expect(write).toHaveBeenCalledWith('::error file=x%2Cy.ts,startLine=1::line 1%0Aline 2\n');
  });
});
