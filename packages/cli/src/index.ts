#!/usr/bin/env node

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import * as path from 'path';
import { buildContext } from './detector';
import { allRules } from './rules';
import { reportFindings } from './reporter';
import { buildCliShipGateReport, printShipGateSummary } from './shipGateReporter';
import { applyFixesInteractive } from './fixer';
import { Finding } from './types';
import { setupGitHubAction } from './ci';

const program = new Command();

program
  .name('shipready')
  .description('Production-Readiness Verifier for B2B SaaS and Indie Hackers projects')
  .version('1.0.0');

program
  .command('scan', { isDefault: true })
  .description('Scans the workspace for configuration, security, and integration vulnerabilities')
  .option('-p, --path <dir>', 'Root directory of the project to scan', '.')
  .option('-j, --json', 'Output findings in raw JSON format', false)
  .option('-f, --fix', 'Automatically attempt to fix configuration issues', false)
  .action(async (options) => {
    const targetDir = path.resolve(options.path);
    const spinner = ora(chalk.cyan('Detecting stack and scanning configurations...')).start();

    try {
      // 1. Build context (lists files and detects tech stack)
      const context = buildContext(targetDir);

      spinner.text = chalk.cyan('Running production-readiness checks...');

      // 2. Run all rules
      let findings: Finding[] = [];
      for (const rule of allRules) {
        try {
          const ruleFindings = await rule.run(context);
          findings.push(...ruleFindings);
        } catch (ruleError: any) {
          findings.push({
            ruleId: rule.id,
            severity: 'error',
            message: `Rule failed to execute: ${ruleError.message || ruleError}`,
          });
        }
      }

      spinner.stop();

      // 2.5 Apply fixes if requested
      if (options.fix && !options.json) {
        const fixed = await applyFixesInteractive(targetDir, findings);
        if (fixed > 0) {
          console.log(chalk.green(`\nApplied ${fixed} auto-fix(es). Re-running scan...\n`));
          // Re-run rules after fixes
          findings = [];
          for (const rule of allRules) {
            try {
              const ruleFindings = await rule.run(context);
              findings.push(...ruleFindings);
            } catch (ruleError: any) {
              findings.push({
                ruleId: rule.id,
                severity: 'error',
                message: `Rule failed to execute: ${ruleError.message || ruleError}`,
              });
            }
          }
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
        const shipGate = buildCliShipGateReport(findings, context.files.length, context.scanScope);
        printShipGateSummary(shipGate);
        const maxBlockers = process.env.SHIPREADY_DOGFOOD_MAX_BLOCKERS
          ? Number.parseInt(process.env.SHIPREADY_DOGFOOD_MAX_BLOCKERS, 10)
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

      const shipGate = buildCliShipGateReport(findings, context.files.length, context.scanScope);
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
    'Initializes a GitHub Actions workflow (.github/workflows/shipready.yml) in your repository',
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
