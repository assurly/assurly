/**
 * Agent Stack Scan — audits the AI agent's own setup (MCP client configs and
 * instruction files), not application source.
 *
 * PRODUCT DECISION (do not "helpfully" reverse):
 * Nothing in this category blocks ship. Findings may use error severity and
 * high confidence for triage priority, but `agent-*` ids are deliberately
 * absent from `HIGH_CONFIDENCE_BLOCKER_RULE_IDS`, and `shipGate` routes
 * non-allowlisted error+high findings to *review*. Pinning every `npx -y pkg`
 * would fail nearly every first scan and permanently destroy trust.
 *
 * Safety rails:
 * - Never echo secret values (shape-only messages via `redactEnvKey`).
 * - Never read outside the project root (callers pass project-local paths only).
 * - Prefer low confidence / warning when a signal is ambiguous.
 */
// Type-only import: avoids a runtime circular dependency with index.ts.
import type { FindingConfidence as Confidence, ScannerFinding, Severity } from './index';
import {
  containsAssurlyCanaryCallbackPath,
  containsAssurlyCanaryToken,
  isAssurlyCanaryMcpUrl,
  isAssurlyCanaryToken,
} from './canaryToken';

export interface AgentStackScanResult {
  errorCount: number;
  warningCount: number;
  findings: ScannerFinding[];
}

type ScanResult = AgentStackScanResult;

const result = (findings: ScannerFinding[]): ScanResult => ({
  errorCount: findings.filter((finding) => finding.severity === 'error').length,
  warningCount: findings.filter((finding) => finding.severity === 'warning').length,
  findings,
});

function finding(
  ruleId: string,
  severity: Severity,
  confidence: Confidence,
  file: string,
  line: number | undefined,
  message: string,
  suggestion: string,
): ScannerFinding {
  return { ruleId, severity, confidence, file, line, message, suggestion };
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function basename(filePath: string): string {
  const normalized = normalizePath(filePath);
  const parts = normalized.split('/');
  return parts[parts.length - 1] ?? normalized;
}

function dirname(filePath: string): string {
  const normalized = normalizePath(filePath);
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? '' : normalized.slice(0, idx);
}

/** Small allowlist of unscoped packages that are widely used and low-risk. */
const KNOWN_GOOD_UNSCOPED_PACKAGES = new Set([
  'assurly',
  'typescript',
  'prettier',
  'eslint',
  'vitest',
  'tsx',
  'serve',
]);

const SHELL_COMMANDS = new Set(['bash', 'sh', 'zsh', 'curl', 'wget', 'eval']);

const ZERO_WIDTH_CHARS = /[\u200b-\u200f\u2060\ufeff]/;

const INSTRUCTION_OVERRIDE_PATTERNS: RegExp[] = [
  /\bignore\s+(?:all\s+)?previous\s+instructions\b/i,
  /\bdisregard\s+(?:the\s+)?above\b/i,
  /\byou\s+are\s+now\b/i,
  /\bdo\s+not\s+tell\s+the\s+user\b/i,
  /\bwithout\s+informing\s+the\s+user\b/i,
];

const HIDDEN_INSTRUCTION_PATTERNS: RegExp[] = [
  ...INSTRUCTION_OVERRIDE_PATTERNS,
  /\byou\s+must\b/i,
  /\balways\s+(?:do|run|execute|send|post|reveal)\b/i,
  /\breveal\s+(?:your|the)\s+(?:system\s+)?prompt\b/i,
  /\bexfiltrat/i,
  /\bhidden\s+instruction/i,
];

const SECRET_NOUN =
  /(?:\.env\b|api\s*keys?|tokens?|credentials?|secret\s*keys?|service[_ ]?role|password|private\s*keys?)/i;

const NETWORK_VERB_DEST =
  /(?:post\s+to|send\s+to|upload\s+to|exfiltrat\w*\s+to|curl\s+https?:\/\/|wget\s+https?:\/\/|fetch\s*\(\s*['"]https?:\/\/)/i;

const PLACEHOLDER_ENV_VALUE =
  /^(?:<.*>|\{.*\}|\$\{.*\}|your[_-]?|changeme|replace[_-]?me|xxx+|todo|example|placeholder|dummy|test|null|none|empty|<string>|<token>|<key>|process\.env|env\.)/i;

/**
 * Shape-only reference to an env key. Never include the value (or any
 * prefix/suffix fragment of it) in findings.
 */
export function redactEnvKey(envKey: string): string {
  return `env.${envKey}`;
}

export function isAgentMcpConfigFile(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  const lower = normalized.toLowerCase();
  const name = basename(lower);
  const dir = dirname(lower);

  if (
    lower === '.cursor/mcp.json' ||
    lower === '.vscode/mcp.json' ||
    lower === '.mcp.json' ||
    lower === '.windsurf/mcp.json'
  ) {
    return true;
  }

  if ((dir === '.cursor' || dir === '.vscode') && /^mcp[^/]*\.json$/.test(name)) {
    return true;
  }

  return false;
}

export function isAgentInstructionFile(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  const lower = normalized.toLowerCase();
  const name = basename(normalized);
  const nameLower = name.toLowerCase();

  if (
    nameLower === 'readme.md' ||
    nameLower === 'claude.md' ||
    nameLower === 'agents.md' ||
    nameLower === 'contributing.md' ||
    nameLower === '.cursorrules' ||
    nameLower === 'copilot-instructions.md'
  ) {
    // Accept at any depth for README/CLAUDE/AGENTS/CONTRIBUTING; copilot file
    // is typically under .github/ but also match the basename anywhere.
    if (nameLower === 'copilot-instructions.md') {
      return lower === '.github/copilot-instructions.md' || nameLower === 'copilot-instructions.md';
    }
    return true;
  }

  if (lower.startsWith('.cursor/rules/')) {
    return true;
  }

  if (/^\.github\/pull_request_template/i.test(lower)) {
    return true;
  }

  if (lower.startsWith('.github/issue_template/')) {
    return true;
  }

  return false;
}

export function isAgentStackFile(filePath: string): boolean {
  return isAgentMcpConfigFile(filePath) || isAgentInstructionFile(filePath);
}

function looksLikeLiveSecret(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || PLACEHOLDER_ENV_VALUE.test(trimmed)) return false;
  // Planted Assurly canaries are intentional tripwires, not leaked credentials.
  if (
    isAssurlyCanaryToken(trimmed) ||
    containsAssurlyCanaryToken(trimmed) ||
    containsAssurlyCanaryCallbackPath(trimmed)
  ) {
    return false;
  }
  if (/^sk_live_[A-Za-z0-9]+/.test(trimmed)) return true;
  if (/^sk-ant-[A-Za-z0-9_\-]+/.test(trimmed)) return true;
  if (/^ghp_[A-Za-z0-9]+/.test(trimmed)) return true;
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(trimmed)) return true;
  if (/service_role/i.test(trimmed) && trimmed.length > 20) return true;
  return false;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

interface McpServerEntry {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string');
  return strings.length === value.length ? strings : undefined;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

/** Parse Cursor/Windsurf (`mcpServers`) or VS Code (`servers`) shapes defensively. */
function parseMcpServers(content: string): McpServerEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const root = parsed as Record<string, unknown>;
  const serversNode = root.mcpServers ?? root.servers;
  if (!serversNode || typeof serversNode !== 'object' || Array.isArray(serversNode)) {
    return null;
  }

  const entries: McpServerEntry[] = [];
  for (const [name, raw] of Object.entries(serversNode as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const server = raw as Record<string, unknown>;
    entries.push({
      name,
      command: typeof server.command === 'string' ? server.command : undefined,
      args: asStringArray(server.args),
      url: typeof server.url === 'string' ? server.url : undefined,
      env: asStringRecord(server.env),
    });
  }
  return entries;
}

function packageArgFromArgs(args: string[] | undefined): string | undefined {
  if (!args || args.length === 0) return undefined;
  for (const arg of args) {
    if (!arg || arg.startsWith('-')) continue;
    // First non-flag argument is the package for npx/bunx/pnpm dlx.
    return arg;
  }
  return undefined;
}

function packageHasPinnedVersion(packageArg: string): boolean {
  // Scoped: @org/name@version  Unscoped: name@version
  // A lone @ at the start is the scope, not a version pin.
  if (packageArg.startsWith('@')) {
    const afterScope = packageArg.slice(1);
    const slash = afterScope.indexOf('/');
    if (slash === -1) return false;
    return afterScope.slice(slash + 1).includes('@');
  }
  return packageArg.includes('@');
}

function isPackageScoped(packageArg: string): boolean {
  if (!packageArg.startsWith('@')) return false;
  const rest = packageArg.slice(1);
  const slash = rest.indexOf('/');
  if (slash <= 0) return false;
  const namePart = rest.slice(slash + 1).split('@')[0] ?? '';
  return namePart.length > 0;
}

function unscopedPackageName(packageArg: string): string {
  const withoutVersion = packageArg.split('@')[0] ?? packageArg;
  return withoutVersion.toLowerCase();
}

function isDlxRunner(command: string | undefined, args: string[] | undefined): boolean {
  if (!command) return false;
  const cmd = command.toLowerCase();
  if (cmd === 'npx' || cmd === 'bunx') return true;
  if (cmd === 'pnpm' && args?.[0] === 'dlx') return true;
  return false;
}

function argsPipeToShell(args: string[] | undefined): boolean {
  if (!args) return false;
  const joined = args.join(' ');
  return (
    /\|\s*(?:bash|sh|zsh)\b/i.test(joined) ||
    /\b(?:bash|sh|zsh)\s+-c\b/i.test(joined) ||
    /\beval\b/i.test(joined)
  );
}

function lineNumberOfSubstring(content: string, substring: string): number | undefined {
  const idx = content.indexOf(substring);
  if (idx === -1) return undefined;
  return content.slice(0, idx).split(/\r?\n/).length;
}

export function scanAgentMcpConfig(content: string, file = '.cursor/mcp.json'): ScanResult {
  const findings: ScannerFinding[] = [];
  const servers = parseMcpServers(content);
  if (!servers) return result(findings);

  for (const server of servers) {
    const command = server.command?.trim();
    const commandBase = command ? basename(command).toLowerCase() : undefined;

    if (commandBase && SHELL_COMMANDS.has(commandBase)) {
      findings.push(
        finding(
          'agent-mcp-shell-execution',
          'error',
          'high',
          file,
          lineNumberOfSubstring(content, `"command"`) ??
            lineNumberOfSubstring(content, server.name),
          `MCP server "${server.name}" runs a shell command (${commandBase}), which can execute arbitrary code from the agent session.`,
          'Point the MCP server at a dedicated executable or package runner instead of a raw shell.',
        ),
      );
    } else if (argsPipeToShell(server.args)) {
      findings.push(
        finding(
          'agent-mcp-shell-execution',
          'error',
          'high',
          file,
          lineNumberOfSubstring(content, server.name),
          `MCP server "${server.name}" pipes arguments into a shell, which can execute arbitrary code from the agent session.`,
          'Remove shell pipes from MCP args; invoke the server binary directly.',
        ),
      );
    }

    if (server.url && !isAssurlyCanaryMcpUrl(server.url)) {
      try {
        const parsedUrl = new URL(server.url);
        if (parsedUrl.protocol === 'http:' && !isLoopbackHost(parsedUrl.hostname)) {
          findings.push(
            finding(
              'agent-mcp-insecure-endpoint',
              'error',
              'high',
              file,
              lineNumberOfSubstring(content, server.url),
              `MCP server "${server.name}" uses a remote http:// endpoint. Credentials and tool traffic can be intercepted.`,
              'Use https:// for remote MCP endpoints, or http:// only for localhost/127.0.0.1.',
            ),
          );
        }
      } catch {
        // Malformed URL — skip; do not throw.
      }
    }

    if (server.env) {
      for (const [envKey, envValue] of Object.entries(server.env)) {
        if (!looksLikeLiveSecret(envValue)) continue;
        findings.push(
          finding(
            'agent-mcp-inline-secret',
            'error',
            'high',
            file,
            lineNumberOfSubstring(content, `"${envKey}"`),
            `${redactEnvKey(envKey)} contains what looks like a live credential. Inline secrets in MCP config are often committed or synced.`,
            `Replace the literal value with a placeholder and load ${envKey} from the environment or a secret manager.`,
          ),
        );
      }
    }

    if (isDlxRunner(command, server.args)) {
      const packageArg = packageArgFromArgs(
        command?.toLowerCase() === 'pnpm' ? server.args?.slice(1) : server.args,
      );
      if (packageArg) {
        if (!packageHasPinnedVersion(packageArg)) {
          findings.push(
            finding(
              'agent-mcp-unpinned-version',
              'warning',
              'low',
              file,
              lineNumberOfSubstring(content, packageArg),
              `MCP server "${server.name}" installs "${packageArg}" without a pinned version, so a future publish can change behaviour silently.`,
              `Pin the package (e.g. "${packageArg}@<version>") in the MCP args.`,
            ),
          );
        }

        if (!isPackageScoped(packageArg)) {
          const name = unscopedPackageName(packageArg);
          if (!KNOWN_GOOD_UNSCOPED_PACKAGES.has(name)) {
            findings.push(
              finding(
                'agent-mcp-unscoped-package',
                'warning',
                'low',
                file,
                lineNumberOfSubstring(content, packageArg),
                `MCP server "${server.name}" uses unscoped package "${name}", which is easier to typosquat than a scoped @org/ package.`,
                'Prefer a scoped package from a known publisher, or confirm the unscoped name is intentional.',
              ),
            );
          }
        }
      }
    }
  }

  return result(findings);
}

function scanHtmlCommentInstructions(content: string, file: string): ScannerFinding[] {
  const findings: ScannerFinding[] = [];
  const commentRe = /<!--([\s\S]*?)-->/g;
  let match: RegExpExecArray | null;
  while ((match = commentRe.exec(content)) !== null) {
    const body = match[1] ?? '';
    const trimmed = body.trim();
    // Section markers like BEGIN:nextjs-agent-rules are not instructions.
    if (/^(?:BEGIN|END):/i.test(trimmed) && trimmed.length < 80) continue;
    if (!HIDDEN_INSTRUCTION_PATTERNS.some((pattern) => pattern.test(body))) continue;

    const line = content.slice(0, match.index).split(/\r?\n/).length;
    findings.push(
      finding(
        'agent-hidden-instruction',
        'error',
        'high',
        file,
        line,
        'Instruction-like text is hidden inside an HTML comment, where readers miss it but models still see it.',
        'Move agent instructions into visible prose, or remove the hidden directive.',
      ),
    );
  }
  return findings;
}

function scanZeroWidthInstructions(content: string, file: string): ScannerFinding[] {
  const findings: ScannerFinding[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!ZERO_WIDTH_CHARS.test(line)) continue;
    // Require adjacent letters so binary/encoding noise does not fire.
    if (!/[A-Za-z]/.test(line.replace(ZERO_WIDTH_CHARS, ''))) continue;
    findings.push(
      finding(
        'agent-hidden-instruction',
        'error',
        'high',
        file,
        i + 1,
        'Zero-width characters sit next to prose, which can hide instructions from human readers.',
        'Remove zero-width characters (U+200B–U+200F, U+2060, U+FEFF) from instruction files.',
      ),
    );
    // One finding per file is enough signal for this pattern.
    break;
  }
  return findings;
}

function scanInstructionOverrides(content: string, file: string): ScannerFinding[] {
  const findings: ScannerFinding[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    for (const pattern of INSTRUCTION_OVERRIDE_PATTERNS) {
      if (!pattern.test(line)) continue;
      findings.push(
        finding(
          'agent-instruction-override',
          'error',
          'medium',
          file,
          i + 1,
          'Instruction file contains language that tries to override the agent’s prior instructions.',
          'Remove override/jailbreak phrasing from project instruction files.',
        ),
      );
      return findings;
    }
  }
  return findings;
}

function scanExfiltrationDirectives(content: string, file: string): ScannerFinding[] {
  const findings: ScannerFinding[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const window = [lines[i], lines[i + 1], lines[i + 2]]
      .filter((line): line is string => typeof line === 'string')
      .join('\n');
    if (!SECRET_NOUN.test(window) || !NETWORK_VERB_DEST.test(window)) continue;
    findings.push(
      finding(
        'agent-exfiltration-directive',
        'error',
        'high',
        file,
        i + 1,
        'Instruction file pairs secret-related terms with a network send directive — a common exfiltration pattern.',
        'Remove directives that tell the agent to send credentials or .env contents to a remote endpoint.',
      ),
    );
    return findings;
  }
  return findings;
}

export function scanAgentInstructionFile(content: string, file = 'README.md'): ScanResult {
  const findings: ScannerFinding[] = [
    ...scanHtmlCommentInstructions(content, file),
    ...scanZeroWidthInstructions(content, file),
    ...scanInstructionOverrides(content, file),
    ...scanExfiltrationDirectives(content, file),
  ];
  return result(findings);
}

/** Dispatch to the MCP or instruction scanner based on the file path. */
export function scanAgentStack(content: string, file = 'README.md'): ScanResult {
  if (isAgentMcpConfigFile(file)) {
    return scanAgentMcpConfig(content, file);
  }
  if (isAgentInstructionFile(file)) {
    return scanAgentInstructionFile(content, file);
  }
  return result([]);
}
