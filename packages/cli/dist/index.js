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
const canaryPlant_1 = require("./canaryPlant");
const scanReportJson_1 = require("./scanReportJson");
const submitScan_1 = require("./submitScan");
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
    .option('-j, --json', 'Output a versioned Ship Gate JSON report (findings + shipScore + scanScope)', false)
    .option('-f, --fix', 'Automatically attempt to fix configuration issues', false)
    .option('--submit', 'Submit Ship Gate SoT to Assurly (findings only — never uploads source). Requires ASSURLY_API_KEY and --repo', false)
    .option('--repo <owner/repo>', 'Connected Assurly repository for --submit (owner/repo)')
    .option('--api-url <url>', 'Assurly API base URL for --submit', process.env.ASSURLY_API_URL || 'https://assurly.dev')
    .option('--agent', 'Focused mode: scan only the agent stack (MCP configs and instruction files)', false)
    .option('--supply', 'Focused mode: scan only install-time trust (npm allowScripts / lockfile scripts)', false)
    .action(async (options) => {
    const targetDir = path.resolve(options.path);
    const agentOnly = Boolean(options.agent);
    const supplyOnly = Boolean(options.supply);
    const focusedLabel = agentOnly && supplyOnly
        ? 'Scanning agent stack and install-time trust...'
        : agentOnly
            ? 'Scanning agent stack (MCP configs and instruction files)...'
            : supplyOnly
                ? 'Scanning install-time trust (allowScripts / lockfile scripts)...'
                : 'Detecting stack and scanning configurations...';
    // Set only for a focused run. The Ship Gate verdict is a claim about the
    // whole project, and a focused scan has not earned it — the same project can
    // report READY TO SHIP under `--supply` and NOT READY under a full scan.
    // Rather than print a verdict that is scoped differently from its wording,
    // focused runs print the findings and say what was and was not examined.
    const surface = agentOnly && supplyOnly
        ? { label: 'agent stack or install-time trust', flag: '--agent --supply' }
        : agentOnly
            ? { label: 'agent stack', flag: '--agent' }
            : supplyOnly
                ? { label: 'install-time trust', flag: '--supply' }
                : undefined;
    const spinner = (0, ora_1.default)(chalk_1.default.cyan(focusedLabel)).start();
    try {
        spinner.text = chalk_1.default.cyan(agentOnly || supplyOnly
            ? 'Running focused checks...'
            : 'Running production-readiness checks...');
        let scanResult = await (0, scanProject_1.scanProjectDirectory)(targetDir, { agentOnly, supplyOnly });
        const { context } = scanResult;
        let { findings } = scanResult;
        let shipGate = scanResult.report;
        spinner.stop();
        // 2.5 Apply fixes if requested
        if (options.fix && !options.json) {
            const fixed = await (0, fixer_1.applyFixesInteractive)(targetDir, findings);
            if (fixed > 0) {
                console.log(chalk_1.default.green(`\nApplied ${fixed} auto-fix(es). Re-running scan...\n`));
                scanResult = await (0, scanProject_1.scanProjectDirectory)(targetDir, { agentOnly, supplyOnly });
                findings = scanResult.findings;
                shipGate = scanResult.report;
            }
            else {
                console.log(chalk_1.default.gray('No auto-fixable issues found.\n'));
            }
        }
        const reportJson = (0, scanReportJson_1.buildAssurlyScanReportJson)({
            findings,
            report: shipGate,
            context,
            summary: '',
            markdown: '',
        });
        if (options.submit) {
            if (surface) {
                throw new Error('Focused scans (--agent/--supply) cannot be submitted as a Ship Gate.');
            }
            const apiKey = process.env.ASSURLY_API_KEY;
            const repo = typeof options.repo === 'string' ? options.repo.trim() : '';
            if (!apiKey) {
                throw new Error('ASSURLY_API_KEY is required for --submit.');
            }
            if (!repo || !repo.includes('/')) {
                throw new Error('--repo owner/repo is required for --submit.');
            }
            const submitted = await (0, submitScan_1.submitScanReport)({
                apiKey,
                apiBaseUrl: String(options.apiUrl),
                repo,
                report: reportJson,
            });
            console.log(chalk_1.default.green(`Submitted Ship Gate to Assurly: ${submitted.verdict} · ${submitted.shipScore}/100 (scan ${submitted.id})`));
        }
        // 3. Output results
        if (options.json) {
            console.log(JSON.stringify(reportJson, null, 2));
        }
        else if (!options.submit) {
            // Log detected stack
            console.log(chalk_1.default.bold('Detected Stack:'));
            console.log(`  Framework:  ${chalk_1.default.green(context.detectedStack.framework.toUpperCase())}`);
            console.log(`  Database:   ${chalk_1.default.green(context.detectedStack.database.toUpperCase())}`);
            console.log(`  Payments:   ${chalk_1.default.green(context.detectedStack.payments.toUpperCase())}`);
            console.log(`  Deployment: ${chalk_1.default.green(context.detectedStack.deployment.toUpperCase())}\n`);
            (0, reporter_1.reportFindings)(findings, undefined, surface);
            if (surface) {
                console.log(chalk_1.default.dim(`  Focused scan (${surface.flag}) — no Ship Gate verdict. ` +
                    'Run `assurly scan` to judge the whole project.\n'));
                process.exit(0);
            }
            (0, shipGateReporter_1.printShipGateSummary)(shipGate);
        }
        else if (!options.json) {
            (0, shipGateReporter_1.printShipGateSummary)(shipGate);
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
program
    .command('canary')
    .description('Silent-alarm tripwire helpers')
    .command('plant')
    .description('Mint ASSURLY_CANARY_URL via Assurly and append it to local .env.example (never uploads source)')
    .option('-p, --path <dir>', 'Root directory of the project', '.')
    .option('--repo <owner/repo>', 'Connected Assurly repository (owner/repo)')
    .option('--api-url <url>', 'Assurly API base URL', process.env.ASSURLY_API_URL || 'https://assurly.dev')
    .action(async (options) => {
    const targetDir = path.resolve(options.path);
    const spinner = (0, ora_1.default)(chalk_1.default.cyan('Planting silent alarm...')).start();
    try {
        const apiKey = process.env.ASSURLY_API_KEY;
        const repo = typeof options.repo === 'string' ? options.repo.trim() : '';
        if (!apiKey) {
            throw new Error('ASSURLY_API_KEY is required to plant a silent alarm.');
        }
        if (!repo || !repo.includes('/')) {
            throw new Error('--repo owner/repo is required.');
        }
        const planted = await (0, canaryPlant_1.plantCanaryLocally)({
            projectPath: targetDir,
            repo,
            apiKey,
            apiBaseUrl: String(options.apiUrl),
        });
        spinner.succeed(chalk_1.default.green(planted.changed
            ? `Planted silent alarm in ${planted.envPath}`
            : `Silent alarm already present in ${planted.envPath}`));
        process.exit(0);
    }
    catch (error) {
        spinner.stop();
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk_1.default.red(`\nPlant failed. ${message}\n`));
        process.exit(1);
    }
});
program.parse(process.argv);
