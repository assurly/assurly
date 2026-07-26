#!/usr/bin/env node

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import * as path from 'path';
import { reportFindings } from './reporter';
import { printShipGateSummary } from './shipGateReporter';
import { scanProjectDirectory } from './scanProject';
import { applyFixesInteractive } from './fixer';
import { setupGitHubAction } from './ci';

const program = new Command();

// Read from package.json rather than hardcoding: the literal had drifted to 1.0.0
// while the package shipped 1.0.2, so `assurly --version` misreported itself in
// every bug report. `dist/index.js` sits one level under the package root.
const { version } = require('../package.json') as { version: string };

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
  .option(
    '--agent',
    'Focused mode: scan only the agent stack (MCP configs and instruction files)',
    false,
  )
  .action(async (options) => {
    const targetDir = path.resolve(options.path);
    const agentOnly = Boolean(options.agent);
    const spinner = ora(
      chalk.cyan(
        agentOnly
          ? 'Scanning agent stack (MCP configs and instruction files)...'
          : 'Detecting stack and scanning configurations...',
      ),
    ).start();

    try {
      spinner.text = chalk.cyan(
        agentOnly ? 'Running agent-stack checks...' : 'Running production-readiness checks...',
      );

      let scanResult = await scanProjectDirectory(targetDir, { agentOnly });
      const { context } = scanResult;
      let { findings } = scanResult;
      let shipGate = scanResult.report;

      spinner.stop();

      // 2.5 Apply fixes if requested
      if (options.fix && !options.json) {
        const fixed = await applyFixesInteractive(targetDir, findings);
        if (fixed > 0) {
          console.log(chalk.green(`\nApplied ${fixed} auto-fix(es). Re-running scan...\n`));
          scanResult = await scanProjectDirectory(targetDir, { agentOnly });
          findings = scanResult.findings;
          shipGate = scanResult.report;
        } else {
          console.log(chalk.gray('No auto-fixable issues found.\n'));
        }
      }

      // 3. Output results
      if (options.json) {
        console.log(JSON.stringify(findings, null, 2));
      } else {
        // Log detected stack
        console.log(chalk.bold('Detected Stack:'));
        console.log(`  Framework:  ${chalk.green(context.detectedStack.framework.toUpperCase())}`);
        console.log(`  Database:   ${chalk.green(context.detectedStack.database.toUpperCase())}`);
        console.log(`  Payments:   ${chalk.green(context.detectedStack.payments.toUpperCase())}`);
        console.log(
          `  Deployment: ${chalk.green(context.detectedStack.deployment.toUpperCase())}\n`,
        );

        reportFindings(findings);
        printShipGateSummary(shipGate);
        const maxBlockers = process.env.ASSURLY_DOGFOOD_MAX_BLOCKERS
          ? Number.parseInt(process.env.ASSURLY_DOGFOOD_MAX_BLOCKERS, 10)
          : undefined;
        if (maxBlockers !== undefined && shipGate.blockers.length > maxBlockers) {
          console.error(
            chalk.red(
              `\nDogfood gate failed: ${shipGate.blockers.length} blockers (max ${maxBlockers}).\n`,
            ),
          );
          process.exit(1);
        }
        process.exit(shipGate.status === 'blocked' ? 1 : 0);
      }

      process.exit(shipGate.status === 'blocked' ? 1 : 0);
    } catch (error: any) {
      spinner.stop();
      console.error(chalk.red(`\nFatal Error: Scan failed. ${error.message || error}\n`));
      process.exit(1);
    }
  });

program
  .command('init')
  .description(
    'Initializes a GitHub Actions workflow (.github/workflows/assurly.yml) in your repository',
  )
  .option('-p, --path <dir>', 'Root directory of the project to initialize', '.')
  .action((options) => {
    const targetDir = path.resolve(options.path);
    const spinner = ora(chalk.cyan('Initializing GitHub Actions workflow...')).start();

    const result = setupGitHubAction(targetDir);

    if (result.success) {
      spinner.succeed(chalk.green(result.message));
      process.exit(0);
    } else {
      spinner.fail(chalk.red(result.message));
      process.exit(1);
    }
  });

program.parse(process.argv);
