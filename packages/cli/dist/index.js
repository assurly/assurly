#!/usr/bin/env node
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const ora_1 = __importDefault(require("ora"));
const chalk_1 = __importDefault(require("chalk"));
const path = __importStar(require("path"));
const reporter_1 = require("./reporter");
const shipGateReporter_1 = require("./shipGateReporter");
const scanProject_1 = require("./scanProject");
const fixer_1 = require("./fixer");
const ci_1 = require("./ci");
const program = new commander_1.Command();
// Read from package.json rather than hardcoding: the literal had drifted to 1.0.0
// while the package shipped 1.0.2, so `assurly --version` misreported itself in
// every bug report. `dist/index.js` sits one level under the package root.
const { version } = require('../package.json');
program
    .name('assurly')
    .description('Pre-deploy ship gate for AI-built SaaS — one verdict before you ship')
    .version(version);
program
    .command('scan', { isDefault: true })
    .description('Scans the workspace for configuration, security, and integration vulnerabilities')
    .option('-p, --path <dir>', 'Root directory of the project to scan', '.')
    .option('-j, --json', 'Output findings in raw JSON format', false)
    .option('-f, --fix', 'Automatically attempt to fix configuration issues', false)
    .option('--agent', 'Focused mode: scan only the agent stack (MCP configs and instruction files)', false)
    .action(async (options) => {
    const targetDir = path.resolve(options.path);
    const agentOnly = Boolean(options.agent);
    const spinner = (0, ora_1.default)(chalk_1.default.cyan(agentOnly
        ? 'Scanning agent stack (MCP configs and instruction files)...'
        : 'Detecting stack and scanning configurations...')).start();
    try {
        spinner.text = chalk_1.default.cyan(agentOnly ? 'Running agent-stack checks...' : 'Running production-readiness checks...');
        let scanResult = await (0, scanProject_1.scanProjectDirectory)(targetDir, { agentOnly });
        const { context } = scanResult;
        let { findings } = scanResult;
        let shipGate = scanResult.report;
        spinner.stop();
        // 2.5 Apply fixes if requested
        if (options.fix && !options.json) {
            const fixed = await (0, fixer_1.applyFixesInteractive)(targetDir, findings);
            if (fixed > 0) {
                console.log(chalk_1.default.green(`\nApplied ${fixed} auto-fix(es). Re-running scan...\n`));
                scanResult = await (0, scanProject_1.scanProjectDirectory)(targetDir, { agentOnly });
                findings = scanResult.findings;
                shipGate = scanResult.report;
            }
            else {
                console.log(chalk_1.default.gray('No auto-fixable issues found.\n'));
            }
        }
        // 3. Output results
        if (options.json) {
            console.log(JSON.stringify(findings, null, 2));
        }
        else {
            // Log detected stack
            console.log(chalk_1.default.bold('Detected Stack:'));
            console.log(`  Framework:  ${chalk_1.default.green(context.detectedStack.framework.toUpperCase())}`);
            console.log(`  Database:   ${chalk_1.default.green(context.detectedStack.database.toUpperCase())}`);
            console.log(`  Payments:   ${chalk_1.default.green(context.detectedStack.payments.toUpperCase())}`);
            console.log(`  Deployment: ${chalk_1.default.green(context.detectedStack.deployment.toUpperCase())}\n`);
            (0, reporter_1.reportFindings)(findings);
            (0, shipGateReporter_1.printShipGateSummary)(shipGate);
            const maxBlockers = process.env.ASSURLY_DOGFOOD_MAX_BLOCKERS
                ? Number.parseInt(process.env.ASSURLY_DOGFOOD_MAX_BLOCKERS, 10)
                : undefined;
            if (maxBlockers !== undefined && shipGate.blockers.length > maxBlockers) {
                console.error(chalk_1.default.red(`\nDogfood gate failed: ${shipGate.blockers.length} blockers (max ${maxBlockers}).\n`));
                process.exit(1);
            }
            process.exit(shipGate.status === 'blocked' ? 1 : 0);
        }
        process.exit(shipGate.status === 'blocked' ? 1 : 0);
    }
    catch (error) {
        spinner.stop();
        console.error(chalk_1.default.red(`\nFatal Error: Scan failed. ${error.message || error}\n`));
        process.exit(1);
    }
});
program
    .command('init')
    .description('Initializes a GitHub Actions workflow (.github/workflows/assurly.yml) in your repository')
    .option('-p, --path <dir>', 'Root directory of the project to initialize', '.')
    .action((options) => {
    const targetDir = path.resolve(options.path);
    const spinner = (0, ora_1.default)(chalk_1.default.cyan('Initializing GitHub Actions workflow...')).start();
    const result = (0, ci_1.setupGitHubAction)(targetDir);
    if (result.success) {
        spinner.succeed(chalk_1.default.green(result.message));
        process.exit(0);
    }
    else {
        spinner.fail(chalk_1.default.red(result.message));
        process.exit(1);
    }
});
program.parse(process.argv);
