import type { ScanScope } from '@shipready/scanner-core';
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
    files: string[];
    scanScope?: ScanScope;
}
/**
 * Represents a single issue found during code scanning.
 */
export interface Finding {
    ruleId: string;
    severity: 'error' | 'warning';
    confidence?: 'high' | 'medium' | 'low';
    file?: string;
    line?: number;
    message: string;
    suggestion?: string;
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
