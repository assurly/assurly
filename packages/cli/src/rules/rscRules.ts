import * as fs from 'fs';
import * as path from 'path';
import { scanRscDataLeaks } from '@assurly/scanner-core';
import { Rule, ProjectContext, Finding } from '../types';

export const rscRules: Rule = {
  id: 'rsc-data-leaks',
  name: 'React Server Components Data Leak check',
  description: 'Detects server-only imports in Client Components and sensitive JSX props.',
  severity: 'error',
  async run(context: ProjectContext): Promise<Finding[]> {
    return context.files
      .filter((file) => /\.(?:js|ts|jsx|tsx)$/.test(file) && !/\.(?:test|spec)\./.test(file))
      .flatMap(
        (file) =>
          scanRscDataLeaks(fs.readFileSync(path.join(context.projectPath, file), 'utf8'), file)
            .findings,
      );
  },
};
