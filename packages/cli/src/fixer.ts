import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import readline from 'readline';
import { execSync } from 'child_process';
import { Finding } from './types';

/**
 * Checks if the project path is a Git repository.
 */
function isGitRepository(projectPath: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: projectPath, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if the Git repository has uncommitted/untracked changes.
 */
function isGitDirty(projectPath: string): boolean {
  try {
    const status = execSync('git status --porcelain', { cwd: projectPath }).toString().trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

/**
 * Creates a safety backup of the working directory using Git stash.
 */
export function setupBackup(projectPath: string): {
  type: 'stash' | 'clean' | 'none';
  reference?: string;
} {
  if (!isGitRepository(projectPath)) {
    return { type: 'none' };
  }

  if (!isGitDirty(projectPath)) {
    return { type: 'clean' };
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const stashName = `assurly-backup-${timestamp}`;

    // Stash all changes (including untracked files)
    execSync(`git stash push --include-untracked -m "${stashName}"`, {
      cwd: projectPath,
      stdio: 'ignore',
    });

    // Restore them immediately so they are present in the working directory
    execSync('git stash apply', { cwd: projectPath, stdio: 'ignore' });

    return { type: 'stash', reference: stashName };
  } catch (error: any) {
    console.error(
      chalk.yellow(`  ⚠️ Warning: Failed to create Git backup stash: ${error.message}`),
    );
    return { type: 'none' };
  }
}

/**
 * Checks if a finding is auto-fixable.
 */
export function isFixable(finding: Finding): boolean {
  return (
    finding.ruleId === 'env-vars-validator' &&
    finding.message.includes("is used in code but not documented in '.env.example'")
  );
}

/**
 * Applies the fix for a single finding.
 */
export function applySingleFix(projectPath: string, finding: Finding): boolean {
  if (
    finding.ruleId === 'env-vars-validator' &&
    finding.message.includes("is used in code but not documented in '.env.example'")
  ) {
    const examplePath = path.join(projectPath, '.env.example');

    if (fs.existsSync(examplePath)) {
      try {
        let content = fs.readFileSync(examplePath, 'utf8');

        // Ensure there is a trailing newline
        if (content.length > 0 && !content.endsWith('\n')) {
          content += '\n';
        }

        const match = finding.message.match(/process\.env\.([A-Z0-9_]+)/);
        if (match) {
          const varName = match[1];

          // Re-verify it is not already in the file content
          const envRegex = new RegExp(`^${varName}\\s*=`, 'm');
          if (!envRegex.test(content)) {
            content += `${varName}=\n`;
            fs.writeFileSync(examplePath, content, 'utf8');
            console.log(chalk.green(`  ✔ [FIXED] Appended ${chalk.bold(varName)} to .env.example`));
            return true;
          }
        }
      } catch (e: any) {
        console.error(chalk.red(`  ❌ Failed to write to .env.example: ${e.message}`));
      }
    }
  }
  return false;
}

/**
 * Interactively prompts the user to select which fixes to apply.
 */
export async function promptSelectFixes(findings: Finding[]): Promise<Finding[]> {
  const fixable = findings.filter(isFixable);
  if (fixable.length === 0) {
    return [];
  }

  // If running in a non-interactive environment, automatically apply all fixes
  const isInteractive =
    process.stdout.isTTY && process.stdin.isTTY && process.env.NODE_ENV !== 'test';
  if (!isInteractive) {
    return fixable;
  }

  return new Promise((resolve) => {
    let cursor = 0;
    const selected = new Set<number>(fixable.map((_, i) => i)); // select all by default
    let printedLines = 0;

    function render() {
      // Clear previously printed lines
      if (printedLines > 0) {
        readline.moveCursor(process.stdout, 0, -printedLines);
        readline.cursorTo(process.stdout, 0);
        readline.clearScreenDown(process.stdout);
      }

      let output = '';
      output += chalk.cyan.bold('\nSelect which auto-fixes you would like to apply:\n');
      output += chalk.gray(
        'Use [Up/Down] to navigate, [Space] to toggle, [Enter] to confirm, [Ctrl+C] to cancel.\n\n',
      );

      for (let i = 0; i < fixable.length; i++) {
        const item = fixable[i];
        const isCurrent = i === cursor;
        const isSel = selected.has(i);

        const checkbox = isSel ? chalk.green('[x]') : '[ ]';
        const pointer = isCurrent ? chalk.cyan('> ') : '  ';

        let desc = item.message;
        const match = item.message.match(/process\.env\.([A-Z0-9_]+)/);
        if (match) {
          desc = `Append ${chalk.bold(match[1])} to .env.example`;
        }

        const fileInfo = item.file ? chalk.gray(` (${item.file})`) : '';

        if (isCurrent) {
          output += `${pointer}${checkbox} ${chalk.cyan(desc)}${fileInfo}\n`;
        } else {
          output += `${pointer}${checkbox} ${desc}${fileInfo}\n`;
        }
      }

      process.stdout.write(output);
      printedLines = output.split('\n').length - 1;
    }

    // Prepare stdin
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);

    // Hide default cursor
    process.stdout.write('\x1B[?25l');

    render();

    function onKeypress(str: string, key: any) {
      if (key && key.ctrl && key.name === 'c') {
        cleanup();
        process.stdout.write('\x1B[?25h'); // Show cursor
        console.log(chalk.yellow('\nAuto-fix cancelled by user.\n'));
        resolve([]);
        return;
      }

      if (key && key.name === 'up') {
        cursor = (cursor - 1 + fixable.length) % fixable.length;
        render();
      } else if (key && key.name === 'down') {
        cursor = (cursor + 1) % fixable.length;
        render();
      } else if (key && key.name === 'space') {
        if (selected.has(cursor)) {
          selected.delete(cursor);
        } else {
          selected.add(cursor);
        }
        render();
      } else if (key && (key.name === 'return' || key.name === 'enter')) {
        cleanup();
        process.stdout.write('\x1B[?25h'); // Show cursor

        // Clear menu to keep output clean
        readline.cursorTo(process.stdout, 0);
        readline.clearScreenDown(process.stdout);

        const chosen = fixable.filter((_, i) => selected.has(i));
        resolve(chosen);
      }
    }

    function cleanup() {
      process.stdin.removeListener('keypress', onKeypress);
      process.stdin.setRawMode(false);
    }

    process.stdin.on('keypress', onKeypress);
  });
}

/**
 * Runs the interactive auto-fixer pipeline.
 */
export async function applyFixesInteractive(
  projectPath: string,
  findings: Finding[],
): Promise<number> {
  const fixable = findings.filter(isFixable);
  if (fixable.length === 0) {
    return 0;
  }

  // 1. Establish Git safety backup
  console.log(chalk.cyan('\nEstablishing safety rollback backup...'));
  const backup = setupBackup(projectPath);

  if (backup.type === 'stash') {
    console.log(chalk.green(`  ✔ [BACKUP] Created Git rollback stash: '${backup.reference}'`));
    console.log(chalk.gray(`  💡 To roll back: git reset --hard && git stash pop`));
  } else if (backup.type === 'clean') {
    console.log(chalk.gray(`  💡 Working directory is clean. To roll back: git reset --hard HEAD`));
  } else {
    console.log(
      chalk.yellow(
        `  ⚠️ Warning: Git repository not detected or backup failed. Auto-fixes will apply without a safety rollback.`,
      ),
    );
  }

  // 2. Select fixes
  const selectedFixes = await promptSelectFixes(findings);
  if (selectedFixes.length === 0) {
    console.log(chalk.gray('No auto-fixes applied.\n'));
    return 0;
  }

  // 3. Apply selected fixes
  console.log(chalk.cyan(`\nApplying ${selectedFixes.length} selected auto-fix(es)...`));
  let fixedCount = 0;
  for (const fix of selectedFixes) {
    if (applySingleFix(projectPath, fix)) {
      fixedCount++;
    }
  }

  return fixedCount;
}
