import * as core from './runtime';
import * as exec from '@actions/exec';
import * as path from 'path';
import * as fs from 'fs';
// Bundled by esbuild; the version pin test asserts this tracks packages/cli.
import cliPackageJson from '../../cli/package.json';

interface Finding {
  ruleId: string;
  severity: 'error' | 'warning';
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}

/** CLI package pin — kept in sync with packages/cli/package.json via index.test.ts. */
export const ASSURLY_CLI_PACKAGE_SPEC = `assurly@${cliPackageJson.version}`;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export async function run(): Promise<void> {
  try {
    const scanPath = core.getInput('path') || '.';
    const cliPathInput = core.getInput('cli-path');

    const absoluteScanPath = path.resolve(scanPath);
    core.info(`Scanning project path: ${absoluteScanPath}`);

    let command = 'npx';
    let args = ['--yes', ASSURLY_CLI_PACKAGE_SPEC, 'scan', '--json', '--path', absoluteScanPath];

    if (cliPathInput) {
      const absoluteCliPath = path.resolve(cliPathInput);
      if (fs.existsSync(absoluteCliPath)) {
        core.info(`Using custom local CLI path: ${absoluteCliPath}`);
        command = 'node';
        args = [absoluteCliPath, 'scan', '--json', '--path', absoluteScanPath];
      } else {
        throw new Error(`Custom CLI path not found: ${absoluteCliPath}`);
      }
    }

    let stdout = '';
    let stderr = '';

    const options: exec.ExecOptions = {
      listeners: {
        stdout: (data: Buffer) => {
          stdout += data.toString();
        },
        stderr: (data: Buffer) => {
          stderr += data.toString();
        },
      },
      silent: true,
      ignoreReturnCode: true,
    };

    core.info(`Executing command: ${command} ${args.join(' ')}`);
    const exitCode = await exec.exec(command, args, options);

    // If exit code is not 0 or 1, there was a execution environment crash
    if (exitCode !== 0 && exitCode !== 1) {
      core.error(stderr);
      throw new Error(`CLI execution failed with exit code ${exitCode}. Error: ${stderr}`);
    }

    let findings: Finding[] = [];

    try {
      const cleanStdout = stdout.trim();
      // Ensure we find the starting JSON array if there's any preceding/succeeding text output
      const jsonStartIndex = cleanStdout.indexOf('[');
      const jsonEndIndex = cleanStdout.lastIndexOf(']');

      if (jsonStartIndex !== -1 && jsonEndIndex !== -1 && jsonStartIndex < jsonEndIndex) {
        const jsonContent = cleanStdout.substring(jsonStartIndex, jsonEndIndex + 1);
        findings = JSON.parse(jsonContent);
      } else if (cleanStdout === '') {
        findings = [];
      } else {
        throw new Error('No JSON output structure detected');
      }
    } catch (parseError: unknown) {
      core.info(`Raw CLI stdout: ${stdout}`);
      core.info(`Raw CLI stderr: ${stderr}`);
      throw new Error(`Failed to parse scan output JSON: ${errorMessage(parseError)}`);
    }

    const errors = findings.filter((f) => f.severity === 'error');
    const warnings = findings.filter((f) => f.severity === 'warning');

    core.setOutput('findings-count', findings.length.toString());
    core.setOutput('errors-count', errors.length.toString());
    core.setOutput('warnings-count', warnings.length.toString());

    // 1. Emit GitHub Annotations
    for (const finding of findings) {
      const fileRelative = finding.file
        ? path.relative(process.cwd(), path.resolve(absoluteScanPath, finding.file))
        : undefined;
      const annotation: core.AnnotationProperties = {
        title: `Assurly: ${finding.ruleId}`,
        file: fileRelative,
        startLine: finding.line,
      };

      const msg = `${finding.message}${finding.suggestion ? `\n💡 Suggestion: ${finding.suggestion}` : ''}`;

      if (finding.severity === 'error') {
        core.error(msg, annotation);
      } else {
        core.warning(msg, annotation);
      }
    }

    // 2. Generate Job Summary (Markdown Report)
    const summary = core.summary.addHeading('🚀 Assurly Production-Readiness Scan Results', 2);

    if (findings.length === 0) {
      summary.addRaw(`
### ✔ Success!
No configuration, integration, or security issues were found. Your project is production-ready! 🚀
`);
    } else {
      summary.addRaw(`
### 📊 Scan Statistics
| Metric | Count |
| --- | --- |
| **Total Findings** | ${findings.length} |
| **Critical Errors ❌** | ${errors.length} |
| **Warnings ⚠️** | ${warnings.length} |

### 🔎 Detailed Findings
`);

      const tableRows = findings.map((f) => {
        const fileCell = f.file ? `\`${f.file}\`` : 'Global';
        const lineCell = f.line ? f.line.toString() : '-';
        const severityCell = f.severity === 'error' ? '❌ Error' : '⚠️ Warning';
        const messageCell = `${f.message}${f.suggestion ? `<br>💡 *Suggestion:* ${f.suggestion}` : ''}`;
        return [fileCell, lineCell, severityCell, `\`${f.ruleId}\``, messageCell];
      });

      summary.addTable([
        [
          { data: 'File', header: true },
          { data: 'Line', header: true },
          { data: 'Severity', header: true },
          { data: 'Rule ID', header: true },
          { data: 'Description & Suggestion', header: true },
        ],
        ...tableRows,
      ]);
    }

    if (process.env.GITHUB_STEP_SUMMARY) {
      await summary.write();
    } else {
      core.info('GITHUB_STEP_SUMMARY is not defined. Skipping summary file write.');
      try {
        const summaryText = summary.stringify();
        core.info(`Generated Job Summary:\n${summaryText}`);
      } catch {
        core.info('Unable to stringify the generated job summary.');
      }
    }

    if (errors.length > 0) {
      core.setFailed(
        `Assurly scan failed with ${errors.length} critical error(s). Please resolve them before merging.`,
      );
    } else {
      core.info('Assurly scan passed successfully!');
    }
  } catch (error: unknown) {
    core.setFailed(`Assurly Action failed: ${errorMessage(error)}`);
  }
}

// Only execute run if this file is the main entry point
if (process.env.NODE_ENV !== 'test') {
  run();
}
