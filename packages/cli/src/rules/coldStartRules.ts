import * as fs from 'fs';
import * as path from 'path';
import { scanColdStart } from '@assurly/scanner-core';
import { Rule, ProjectContext, Finding } from '../types';

export const coldStartRules: Rule = {
  id: 'cold-start-optimization',
  name: 'Serverless Cold Start Optimization check',
  description: 'Detects heavy whole-package imports in serverless API routes.',
  severity: 'warning',
  async run(context: ProjectContext): Promise<Finding[]> {
    return context.files
      .filter((file) => /^(?:src\/)?(?:app|pages)\/api\/.+\.(?:js|ts|jsx|tsx)$/.test(file))
      .flatMap(
        (file) =>
          scanColdStart(fs.readFileSync(path.join(context.projectPath, file), 'utf8'), file)
            .findings,
      );
  },
};
