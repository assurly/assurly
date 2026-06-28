import * as fs from 'fs';
import * as path from 'path';
import { Project, SyntaxKind, Node } from 'ts-morph';
import { Rule, ProjectContext, Finding } from '../types';

/**
 * Rule to check for database client instantiations inside serverless function scopes.
 */
export const dbPoolRules: Rule = {
  id: 'database-connection-pooling',
  name: 'Database Connection Pool singleton check',
  description:
    'Ensures database clients (like PrismaClient or pg.Pool) are not instantiated inside Next.js API routes / request handlers to prevent connection pool exhaustion.',
  severity: 'error',

  async run(context: ProjectContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    const rootPath = context.projectPath;

    // Filter files to only target Next.js API route/handler files
    const apiRouteFiles = context.files.filter((file) => {
      const normalized = file.replace(/\\/g, '/');
      const isApiRoute =
        normalized.startsWith('app/api/') ||
        normalized.startsWith('pages/api/') ||
        normalized.startsWith('src/app/api/') ||
        normalized.startsWith('src/pages/api/');
      return isApiRoute && /\.(js|ts|jsx|tsx)$/.test(file);
    });

    if (apiRouteFiles.length === 0) {
      return findings;
    }

    // Initialize an in-memory ts-morph project
    const project = new Project({ useInMemoryFileSystem: true });

    const targetDbClasses = ['PrismaClient', 'Pool', 'Client', 'MongoClient'];

    for (const file of apiRouteFiles) {
      try {
        const fullPath = path.join(rootPath, file);
        const content = fs.readFileSync(fullPath, 'utf8');

        // Create virtual source file to parse AST
        const sourceFile = project.createSourceFile(file, content, { overwrite: true });
        const newExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression);

        for (const newExpr of newExpressions) {
          const className = newExpr.getExpression().getText();

          if (targetDbClasses.includes(className)) {
            // Traverse ancestors to check if it's declared inside a function scope
            let parent: Node | undefined = newExpr.getParent();
            let isInsideFunction = false;
            let functionName = 'anonymous function';

            while (parent) {
              const kind = parent.getKind();

              if (
                kind === SyntaxKind.FunctionDeclaration ||
                kind === SyntaxKind.FunctionExpression ||
                kind === SyntaxKind.ArrowFunction ||
                kind === SyntaxKind.MethodDeclaration
              ) {
                isInsideFunction = true;

                // Try to extract function name if present
                if (kind === SyntaxKind.FunctionDeclaration) {
                  const decl = parent.asKind(SyntaxKind.FunctionDeclaration);
                  functionName = decl?.getName() || functionName;
                } else if (kind === SyntaxKind.MethodDeclaration) {
                  const decl = parent.asKind(SyntaxKind.MethodDeclaration);
                  functionName = decl?.getName() || functionName;
                } else {
                  // Check if it's assigned to a variable, e.g. const GET = async () => ...
                  const varDecl = parent.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
                  if (varDecl) {
                    functionName = varDecl.getName();
                  }
                }
                break;
              }
              parent = parent.getParent();
            }

            if (isInsideFunction) {
              findings.push({
                ruleId: this.id,
                severity: 'error',
                file,
                line: newExpr.getStartLineNumber(),
                message: `Database client '${className}' is instantiated inside function '${functionName}' in a serverless API route. This will open a new database connection on every request and quickly exhaust your database connection pool.`,
                suggestion: `Move 'new ${className}()' outside the function scope (as a global singleton) or import it from a shared database helper file.`,
              });
            }
          }
        }
      } catch (error) {
        // Ignore read/parse errors for robustness
      }
    }

    return findings;
  },
};
