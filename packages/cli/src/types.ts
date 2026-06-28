/**
 * Represents the detected tech stack of the project.
 */
export interface TechStack {
  framework: 'nextjs' | 'unknown';
  database: 'supabase' | 'prisma' | 'none';
  payments: 'stripe' | 'none';
  deployment: 'vercel' | 'unknown';
}

/**
 * Context provided to each rule during execution.
 */
export interface ProjectContext {
  projectPath: string;
  detectedStack: TechStack;
  files: string[]; // List of relative file paths in the project
}

/**
 * Represents a single issue found during code scanning.
 */
export interface Finding {
  ruleId: string;
  severity: 'error' | 'warning';
  file?: string; // Relative path to the file containing the issue
  line?: number; // Line number, if applicable
  message: string; // Detail description of the finding
  suggestion?: string; // Auto-fix suggestion or code patch
}

/**
 * Interface that all static analysis rules must implement.
 */
export interface Rule {
  id: string;
  name: string;
  description: string;
  severity: 'error' | 'warning';
  run(context: ProjectContext): Promise<Finding[]>;
}
