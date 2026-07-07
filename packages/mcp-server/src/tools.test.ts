import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  ASSURLY_MCP_TOOL_NAMES,
  handleExplainRule,
  handleScanFiles,
  handleScanPath,
} from './tools';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const BROKEN_PROJECT = path.join(REPO_ROOT, 'test-projects/broken-project');
const CLEAN_PROJECT = path.join(REPO_ROOT, 'test-projects/clean-project');

function textBlocks(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n');
}

describe('Assurly MCP tool handlers', () => {
  it('exports the three MCP tool names', () => {
    expect(ASSURLY_MCP_TOOL_NAMES).toEqual([
      'assurly_scan_path',
      'assurly_scan_files',
      'assurly_explain_rule',
    ]);
  });

  it('assurly_scan_path returns NOT READY TO SHIP for broken-project', async () => {
    const result = await handleScanPath({ path: BROKEN_PROJECT });
    const output = textBlocks(result);
    expect(output).toContain('NOT READY TO SHIP');
    expect(result.isError).not.toBe(true);
  });

  it('assurly_scan_path returns no blockers for clean-project', async () => {
    const result = await handleScanPath({ path: CLEAN_PROJECT });
    const output = textBlocks(result);
    expect(output).not.toContain('NOT READY TO SHIP');
    expect(result.isError).not.toBe(true);
  });

  it('assurly_scan_files returns NOT READY TO SHIP for SQL without RLS', async () => {
    const sql = fs.readFileSync(path.join(BROKEN_PROJECT, 'supabase/migrations/init.sql'), 'utf8');
    const packageJson = fs.readFileSync(path.join(BROKEN_PROJECT, 'package.json'), 'utf8');

    const result = await handleScanFiles({
      files: [
        { path: 'package.json', content: packageJson },
        { path: 'supabase/migrations/init.sql', content: sql },
      ],
    });

    const output = textBlocks(result);
    expect(output).toContain('NOT READY TO SHIP');
    expect(output).toMatch(/blocker|Blockers/i);
  });

  it('assurly_scan_files returns READY TO SHIP for minimal clean fixtures', async () => {
    const result = await handleScanFiles({
      files: [
        {
          path: 'package.json',
          content: JSON.stringify(
            {
              dependencies: {
                next: '14.0.0',
                '@supabase/supabase-js': '2.0.0',
                stripe: '14.0.0',
              },
            },
            null,
            2,
          ),
        },
        {
          path: '.env.example',
          content: 'NEXT_PUBLIC_SUPABASE_URL=\nNEXT_PUBLIC_SUPABASE_ANON_KEY=\n',
        },
        {
          path: 'supabase/migrations/init.sql',
          content: [
            'CREATE TABLE users (',
            '  id uuid primary key,',
            '  email text',
            ');',
            '',
            'ALTER TABLE users ENABLE ROW LEVEL SECURITY;',
          ].join('\n'),
        },
        {
          path: 'tsconfig.json',
          content: JSON.stringify(
            {
              compilerOptions: {
                strict: true,
              },
            },
            null,
            2,
          ),
        },
        {
          path: '.github/workflows/assurly.yml',
          content: [
            'name: Assurly',
            'on: push',
            'jobs:',
            '  scan:',
            '    runs-on: ubuntu-latest',
            '    steps:',
            '      - run: npx assurly scan',
          ].join('\n'),
        },
      ],
    });

    const output = textBlocks(result);
    expect(output).toContain('READY TO SHIP');
    expect(output).not.toContain('NOT READY TO SHIP');
  });

  it('assurly_explain_rule returns guidance for supabase-rls', () => {
    const result = handleExplainRule({ ruleId: 'supabase-rls' });
    const output = textBlocks(result);
    expect(output).toMatch(/Row-Level Security|RLS/i);
    expect(output).toMatch(/ALTER TABLE/i);
    expect(result.isError).not.toBe(true);
  });
});
