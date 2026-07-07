import * as fs from 'fs';
import * as path from 'path';
import { scanSqlMigration } from '@assurly/scanner-core';
import { Rule, ProjectContext, Finding } from '../types';

export const sqlSafetyRules: Rule = {
  id: 'database-migration-safety',
  name: 'Database Migration Safety check',
  description: 'Detects unsafe NOT NULL additions in database migrations.',
  severity: 'error',
  async run(context: ProjectContext): Promise<Finding[]> {
    return context.files
      .filter((file) => file.endsWith('.sql'))
      .flatMap((file) =>
        scanSqlMigration(
          fs.readFileSync(path.join(context.projectPath, file), 'utf8'),
          file,
        ).findings.filter((finding) => finding.ruleId === this.id),
      );
  },
};
