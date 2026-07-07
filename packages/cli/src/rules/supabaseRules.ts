import * as fs from 'fs';
import * as path from 'path';
import {
  scanEnvVariables,
  scanSqlMigrations,
  scanSupabaseClientLeaks,
} from '@assurly/scanner-core';
import { Finding, ProjectContext, Rule } from '../types';

export const supabaseRules: Rule = {
  id: 'supabase-security-checks',
  name: 'Supabase Security Validation',
  description: 'Checks RLS configuration and service-role exposure in client code.',
  severity: 'error',
  async run(context: ProjectContext): Promise<Finding[]> {
    if (context.detectedStack.database !== 'supabase') return [];
    const read = (file: string): string =>
      fs.readFileSync(path.join(context.projectPath, file), 'utf8');
    const findings: Finding[] = [];
    const sql = context.files
      .filter((file) => file.endsWith('.sql'))
      .map((file) => ({ file, content: read(file) }));
    findings.push(
      ...scanSqlMigrations(sql)
        .findings.filter((finding) => finding.ruleId === 'supabase-rls')
        .map((finding) => ({
          ...finding,
          ruleId: this.id,
          message: finding.message.replace('is created but', 'is created in migration files, but'),
        })),
    );

    for (const file of context.files.filter((candidate) => candidate.startsWith('.env'))) {
      findings.push(
        ...scanEnvVariables(read(file), '', file, 'code.ts')
          .findings.filter((finding) => finding.ruleId === 'public-secret')
          .map((finding) => ({ ...finding, ruleId: this.id })),
      );
    }
    for (const file of context.files.filter((candidate) =>
      /\.(?:js|ts|jsx|tsx)$/.test(candidate),
    )) {
      findings.push(
        ...scanSupabaseClientLeaks(read(file), file).findings.map((finding) => ({
          ...finding,
          ruleId: this.id,
        })),
      );
    }
    return findings;
  },
};
