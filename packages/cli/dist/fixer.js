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
exports.setupBackup = setupBackup;
exports.isFixable = isFixable;
exports.applySingleFix = applySingleFix;
exports.promptSelectFixes = promptSelectFixes;
exports.applyFixesInteractive = applyFixesInteractive;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const chalk_1 = __importDefault(require("chalk"));
const readline_1 = __importDefault(require("readline"));
const child_process_1 = require("child_process");
/**
 * Checks if the project path is a Git repository.
 */
function isGitRepository(projectPath) {
    try {
        (0, child_process_1.execSync)('git rev-parse --is-inside-work-tree', { cwd: projectPath, stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Checks if the Git repository has uncommitted/untracked changes.
 */
function isGitDirty(projectPath) {
    try {
        const status = (0, child_process_1.execSync)('git status --porcelain', { cwd: projectPath }).toString().trim();
        return status.length > 0;
    }
    catch {
        return false;
    }
}
/**
 * Creates a safety backup of the working directory using Git stash.
 */
function setupBackup(projectPath) {
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
        (0, child_process_1.execSync)(`git stash push --include-untracked -m "${stashName}"`, {
            cwd: projectPath,
            stdio: 'ignore',
        });
        // Restore them immediately so they are present in the working directory
        (0, child_process_1.execSync)('git stash apply', { cwd: projectPath, stdio: 'ignore' });
        return { type: 'stash', reference: stashName };
    }
    catch (error) {
        console.error(chalk_1.default.yellow(`  ⚠️ Warning: Failed to create Git backup stash: ${error.message}`));
        return { type: 'none' };
    }
}
/**
 * Checks if a finding is auto-fixable.
 */
function isFixable(finding) {
    return (finding.ruleId === 'env-vars-validator' &&
        finding.message.includes("is used in code but not documented in '.env.example'"));
}
/**
 * Applies the fix for a single finding.
 */
function applySingleFix(projectPath, finding) {
    if (finding.ruleId === 'env-vars-validator' &&
        finding.message.includes("is used in code but not documented in '.env.example'")) {
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
                        console.log(chalk_1.default.green(`  ✔ [FIXED] Appended ${chalk_1.default.bold(varName)} to .env.example`));
                        return true;
                    }
                }
            }
            catch (e) {
                console.error(chalk_1.default.red(`  ❌ Failed to write to .env.example: ${e.message}`));
            }
        }
    }
    return false;
}
/**
 * Interactively prompts the user to select which fixes to apply.
 */
async function promptSelectFixes(findings) {
    const fixable = findings.filter(isFixable);
    if (fixable.length === 0) {
        return [];
    }
    // If running in a non-interactive environment, automatically apply all fixes
    const isInteractive = process.stdout.isTTY && process.stdin.isTTY && process.env.NODE_ENV !== 'test';
    if (!isInteractive) {
        return fixable;
    }
    return new Promise((resolve) => {
        let cursor = 0;
        const selected = new Set(fixable.map((_, i) => i)); // select all by default
        let printedLines = 0;
        function render() {
            // Clear previously printed lines
            if (printedLines > 0) {
                readline_1.default.moveCursor(process.stdout, 0, -printedLines);
                readline_1.default.cursorTo(process.stdout, 0);
                readline_1.default.clearScreenDown(process.stdout);
            }
            let output = '';
            output += chalk_1.default.cyan.bold('\nSelect which auto-fixes you would like to apply:\n');
            output += chalk_1.default.gray('Use [Up/Down] to navigate, [Space] to toggle, [Enter] to confirm, [Ctrl+C] to cancel.\n\n');
            for (let i = 0; i < fixable.length; i++) {
                const item = fixable[i];
                const isCurrent = i === cursor;
                const isSel = selected.has(i);
                const checkbox = isSel ? chalk_1.default.green('[x]') : '[ ]';
                const pointer = isCurrent ? chalk_1.default.cyan('> ') : '  ';
                let desc = item.message;
                const match = item.message.match(/process\.env\.([A-Z0-9_]+)/);
                if (match) {
                    desc = `Append ${chalk_1.default.bold(match[1])} to .env.example`;
                }
                const fileInfo = item.file ? chalk_1.default.gray(` (${item.file})`) : '';
                if (isCurrent) {
                    output += `${pointer}${checkbox} ${chalk_1.default.cyan(desc)}${fileInfo}\n`;
                }
                else {
                    output += `${pointer}${checkbox} ${desc}${fileInfo}\n`;
                }
            }
            process.stdout.write(output);
            printedLines = output.split('\n').length - 1;
        }
        // Prepare stdin
        readline_1.default.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
        // Hide default cursor
        process.stdout.write('\x1B[?25l');
        render();
        function onKeypress(str, key) {
            if (key && key.ctrl && key.name === 'c') {
                cleanup();
                process.stdout.write('\x1B[?25h'); // Show cursor
                console.log(chalk_1.default.yellow('\nAuto-fix cancelled by user.\n'));
                resolve([]);
                return;
            }
            if (key && key.name === 'up') {
                cursor = (cursor - 1 + fixable.length) % fixable.length;
                render();
            }
            else if (key && key.name === 'down') {
                cursor = (cursor + 1) % fixable.length;
                render();
            }
            else if (key && key.name === 'space') {
                if (selected.has(cursor)) {
                    selected.delete(cursor);
                }
                else {
                    selected.add(cursor);
                }
                render();
            }
            else if (key && (key.name === 'return' || key.name === 'enter')) {
                cleanup();
                process.stdout.write('\x1B[?25h'); // Show cursor
                // Clear menu to keep output clean
                readline_1.default.cursorTo(process.stdout, 0);
                readline_1.default.clearScreenDown(process.stdout);
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
async function applyFixesInteractive(projectPath, findings) {
    const fixable = findings.filter(isFixable);
    if (fixable.length === 0) {
        return 0;
    }
    // 1. Establish Git safety backup
    console.log(chalk_1.default.cyan('\nEstablishing safety rollback backup...'));
    const backup = setupBackup(projectPath);
    if (backup.type === 'stash') {
        console.log(chalk_1.default.green(`  ✔ [BACKUP] Created Git rollback stash: '${backup.reference}'`));
        console.log(chalk_1.default.gray(`  💡 To roll back: git reset --hard && git stash pop`));
    }
    else if (backup.type === 'clean') {
        console.log(chalk_1.default.gray(`  💡 Working directory is clean. To roll back: git reset --hard HEAD`));
    }
    else {
        console.log(chalk_1.default.yellow(`  ⚠️ Warning: Git repository not detected or backup failed. Auto-fixes will apply without a safety rollback.`));
    }
    // 2. Select fixes
    const selectedFixes = await promptSelectFixes(findings);
    if (selectedFixes.length === 0) {
        console.log(chalk_1.default.gray('No auto-fixes applied.\n'));
        return 0;
    }
    // 3. Apply selected fixes
    console.log(chalk_1.default.cyan(`\nApplying ${selectedFixes.length} selected auto-fix(es)...`));
    let fixedCount = 0;
    for (const fix of selectedFixes) {
        if (applySingleFix(projectPath, fix)) {
            fixedCount++;
        }
    }
    return fixedCount;
}
