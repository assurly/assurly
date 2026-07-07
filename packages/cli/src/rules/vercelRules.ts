import * as fs from 'fs';
import * as path from 'path';
import { scanEdgeRuntime } from '@assurly/scanner-core';
import { Finding, ProjectContext, Rule } from '../types';

export const vercelRules: Rule = {
  id: 'vercel-edge-compatibility',
  name: 'Vercel Edge Runtime Compatibility',
  description: 'Detects Node.js-only imports in Edge Runtime modules.',
  severity: 'error',
  async run(context: ProjectContext): Promise<Finding[]> {
    return context.files
      .filter((file) => /\.(?:js|ts|jsx|tsx)$/.test(file))
      .flatMap(
        (file) =>
          scanEdgeRuntime(fs.readFileSync(path.join(context.projectPath, file), 'utf8'), file)
            .findings,
      );
  },
};
