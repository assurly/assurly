"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbPoolRules = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ts_morph_1 = require("ts-morph");
/**
 * Rule to check for database client instantiations inside serverless function scopes.
 */
exports.dbPoolRules = {
    id: 'database-connection-pooling',
    name: 'Database Connection Pool singleton check',
    description: 'Ensures database clients (like PrismaClient or pg.Pool) are not instantiated inside Next.js API routes / request handlers to prevent connection pool exhaustion.',
    severity: 'error',
    async run(context) {
        const findings = [];
        const rootPath = context.projectPath;
        // Filter files to only target Next.js API route/handler files
        const apiRouteFiles = context.files.filter((file) => {
            const normalized = file.replace(/\\/g, '/');
            const isApiRoute = normalized.startsWith('app/api/') ||
                normalized.startsWith('pages/api/') ||
                normalized.startsWith('src/app/api/') ||
                normalized.startsWith('src/pages/api/');
            return isApiRoute && /\.(js|ts|jsx|tsx)$/.test(file);
        });
        if (apiRouteFiles.length === 0) {
            return findings;
        }
        // Initialize an in-memory ts-morph project
        const project = new ts_morph_1.Project({ useInMemoryFileSystem: true });
        const targetDbClasses = ['PrismaClient', 'Pool', 'Client', 'MongoClient'];
        for (const file of apiRouteFiles) {
            try {
                const fullPath = path.join(rootPath, file);
                const content = fs.readFileSync(fullPath, 'utf8');
                // Create virtual source file to parse AST
                const sourceFile = project.createSourceFile(file, content, { overwrite: true });
                const newExpressions = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.NewExpression);
                for (const newExpr of newExpressions) {
                    const className = newExpr.getExpression().getText();
                    if (targetDbClasses.includes(className)) {
                        // Traverse ancestors to check if it's declared inside a function scope
                        let parent = newExpr.getParent();
                        let isInsideFunction = false;
                        let functionName = 'anonymous function';
                        while (parent) {
                            const kind = parent.getKind();
                            if (kind === ts_morph_1.SyntaxKind.FunctionDeclaration ||
                                kind === ts_morph_1.SyntaxKind.FunctionExpression ||
                                kind === ts_morph_1.SyntaxKind.ArrowFunction ||
                                kind === ts_morph_1.SyntaxKind.MethodDeclaration) {
                                isInsideFunction = true;
                                // Try to extract function name if present
                                if (kind === ts_morph_1.SyntaxKind.FunctionDeclaration) {
                                    const decl = parent.asKind(ts_morph_1.SyntaxKind.FunctionDeclaration);
                                    functionName = decl?.getName() || functionName;
                                }
                                else if (kind === ts_morph_1.SyntaxKind.MethodDeclaration) {
                                    const decl = parent.asKind(ts_morph_1.SyntaxKind.MethodDeclaration);
                                    functionName = decl?.getName() || functionName;
                                }
                                else {
                                    // Check if it's assigned to a variable, e.g. const GET = async () => ...
                                    const varDecl = parent.getFirstAncestorByKind(ts_morph_1.SyntaxKind.VariableDeclaration);
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
            }
            catch (error) {
                // Ignore read/parse errors for robustness
            }
        }
        return findings;
    },
};
