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
exports.tsconfigRules = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const scanner_core_1 = require("@assurly/scanner-core");
function posixPath(filePath) {
    return filePath.replace(/\\/g, '/');
}
function isTsconfigScanPath(relativePath) {
    const posix = posixPath(relativePath);
    return posix === 'tsconfig.json' || /^(apps|packages)\/[^/]+\/tsconfig\.json$/.test(posix);
}
function readTsconfigSources(projectPath, files) {
    const listed = files.filter(isTsconfigScanPath).map(posixPath);
    if (!listed.includes('tsconfig.json')) {
        const rootFull = path.join(projectPath, 'tsconfig.json');
        if (fs.existsSync(rootFull))
            listed.unshift('tsconfig.json');
    }
    const sources = [];
    const seen = new Set();
    for (const relative of listed) {
        if (seen.has(relative))
            continue;
        seen.add(relative);
        try {
            sources.push({
                file: relative,
                content: fs.readFileSync(path.join(projectPath, relative), 'utf8'),
            });
        }
        catch {
            // Skip unreadable paths; scanTsconfigStrict treats an empty set as missing.
        }
    }
    return sources;
}
/**
 * Rule to check if strict mode is enabled in tsconfig.json.
 */
exports.tsconfigRules = {
    id: 'typescript-strict-mode',
    name: 'TypeScript Strict Mode Validation',
    description: 'Ensures compilerOptions.strict is set to true in tsconfig.json to enforce maximum type safety.',
    severity: 'warning',
    async run(context) {
        return (0, scanner_core_1.scanTsconfigStrict)(readTsconfigSources(context.projectPath, context.files)).findings;
    },
};
