import { parse } from '@babel/parser';
import type { Node } from '@babel/types';
// Type-only import: avoids a runtime circular dependency with index.ts
// (which re-exports this module's scan functions), since type imports are
// erased at compile time.
import type { FindingConfidence as Confidence, ScannerFinding, Severity } from './index';

export interface AiAppSecurityScanResult {
  errorCount: number;
  warningCount: number;
  findings: ScannerFinding[];
}

type AstNode = Node & Record<string, unknown>;
type ScanResult = AiAppSecurityScanResult;

const result = (findings: ScannerFinding[]): ScanResult => ({
  errorCount: findings.filter((finding) => finding.severity === 'error').length,
  warningCount: findings.filter((finding) => finding.severity === 'warning').length,
  findings,
});

function parseCode(content: string): AstNode {
  return parse(content, {
    sourceType: 'unambiguous',
    errorRecovery: true,
    plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties', 'topLevelAwait'],
  }) as unknown as AstNode;
}

function walk(node: unknown, visit: (node: AstNode) => void): void {
  if (!node || typeof node !== 'object') return;
  const candidate = node as Record<string, unknown>;
  if (typeof candidate.type === 'string') visit(candidate as AstNode);
  for (const [key, value] of Object.entries(candidate)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra') continue;
    if (Array.isArray(value)) value.forEach((item) => walk(item, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

const lineOf = (node: AstNode): number | undefined =>
  (node.loc as { start?: { line?: number } } | undefined)?.start?.line;

function isClientScope(content: string, ast: AstNode): boolean {
  const program = ast.program as { directives?: Array<{ value?: { value?: string } }> } | undefined;
  if (program?.directives?.some((directive) => directive.value?.value === 'use client')) {
    return true;
  }
  return /NEXT_PUBLIC_[A-Z0-9_]+/.test(content);
}

function isRouteHandlerFile(file: string): boolean {
  const normalized = file.replace(/\\/g, '/').toLowerCase();
  return (
    normalized.endsWith('/route.ts') ||
    normalized.endsWith('/route.js') ||
    normalized.endsWith('/route.tsx') ||
    normalized.includes('/api/')
  );
}

function isChatStyleRoute(file: string, content: string): boolean {
  const normalized = file.replace(/\\/g, '/').toLowerCase();
  if (/\/api\/chat\b/.test(normalized) || /\/chat\/route\./.test(normalized)) {
    return true;
  }
  return /\b(streamText|streamUI|OpenAIStream|StreamingTextResponse)\s*\(/.test(content);
}

const AUTH_GUARD_PATTERNS = [
  /\bgetServerSession\s*\(/,
  /\bauth\s*\(\s*\)/,
  /\bcurrentUser\s*\(/,
  /\brequireAuth\s*\(/,
  /\brequireUser\s*\(/,
  /\brequireSession\s*\(/,
  /\bgetSession\s*\(/,
  /\bverifySession\s*\(/,
  /\bsupabase\.auth\.getUser\s*\(/,
  /\bcookies\s*\(\s*\)\.get\s*\(/,
  /\bheaders\s*\(\s*\)\.get\s*\(\s*['"]authorization['"]/i,
  /\bUnauthorized\b/,
  /\bstatus:\s*401\b/,
  /\bNextResponse\.json\([^)]*401/,
];

const RATE_LIMIT_PATTERNS = [
  /\brateLimit(?:er)?\s*\(/i,
  /\bcheckRateLimit\s*\(/,
  /\bupstash.*ratelimit/i,
  /\bRATE_LIMITS\b/,
  /\bspendLimit\b/i,
  /\btokenBudget\b/i,
  /\bmaxRequestsPer/i,
];

const LLM_CALL_PATTERNS = [
  /\bopenai\s*\(/i,
  /\bcreateOpenAI\s*\(/,
  /\banthropic\s*\(/i,
  /\bcreateAnthropic\s*\(/,
  /\bstreamText\s*\(/,
  /\bgenerateText\s*\(/,
  /\bstreamUI\s*\(/,
  /\bOpenAIStream\s*\(/,
  /\bchat\.completions\.create\s*\(/,
  /\bmessages\.create\s*\(/,
  /\binvokeTool\s*\(/,
  /\btool\s*\(\s*\{/,
  /\bfrom\s+['"]@ai-sdk\//,
  /\bfrom\s+['"]openai['"]/,
  /\bfrom\s+['"]@anthropic-ai\//,
];

const LLM_KEY_IDENTIFIERS = new Set([
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_TOKEN',
  'ANTHROPIC_API_TOKEN',
]);

const PII_FIELD_PATTERN =
  /\b(email|phone|phoneNumber|address|streetAddress|postalCode|zipCode|ssn|dateOfBirth)\b/i;

function pushFinding(findings: ScannerFinding[], seen: Set<string>, finding: ScannerFinding): void {
  const key = `${finding.ruleId}:${finding.file}:${finding.line ?? 0}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push(finding);
}

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

export function scanAiLlmKeyLeak(content: string, file = 'component.tsx'): ScanResult {
  const findings: ScannerFinding[] = [];
  const seen = new Set<string>();
  const lowerFile = file.toLowerCase();

  if (lowerFile.endsWith('.env.example') || lowerFile.endsWith('.env')) {
    content.split(/\r?\n/).forEach((rawLine, index) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) return;
      if (/^NEXT_PUBLIC_(?:OPENAI|ANTHROPIC)_/i.test(line)) {
        pushFinding(
          findings,
          seen,
          finding(
            'ai-llm-key-in-client',
            'error',
            'high',
            file,
            index + 1,
            `'${line.split('=')[0]}' exposes an LLM credential namespace to the browser bundle.`,
            'Remove the NEXT_PUBLIC_ prefix and keep LLM credentials in server-only environment variables.',
          ),
        );
      }
    });
    return result(findings);
  }

  let ast: AstNode;
  try {
    ast = parseCode(content);
  } catch {
    return result(findings);
  }

  const clientScope = isClientScope(content, ast);
  if (!clientScope && !/NEXT_PUBLIC_/i.test(content)) {
    return result(findings);
  }

  walk(ast, (node) => {
    if (node.type === 'Identifier' && LLM_KEY_IDENTIFIERS.has(String(node.name))) {
      pushFinding(
        findings,
        seen,
        finding(
          'ai-llm-key-in-client',
          'error',
          'high',
          file,
          lineOf(node),
          `LLM API key identifier '${node.name}' is referenced in client-exposed code.`,
          'Move LLM API keys to server-only route handlers or environment variables without the NEXT_PUBLIC_ prefix.',
        ),
      );
    }

    if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
      const object = node.object as AstNode | undefined;
      const property = node.property as AstNode | undefined;
      if (
        object?.type === 'MemberExpression' &&
        (object.object as AstNode | undefined)?.type === 'Identifier' &&
        (object.object as AstNode).name === 'process' &&
        (object.property as AstNode | undefined)?.type === 'Identifier' &&
        (object.property as AstNode).name === 'env' &&
        property?.type === 'Identifier' &&
        LLM_KEY_IDENTIFIERS.has(String(property.name))
      ) {
        pushFinding(
          findings,
          seen,
          finding(
            'ai-llm-key-in-client',
            'error',
            'high',
            file,
            lineOf(node),
            `LLM API key 'process.env.${property.name}' is referenced in client-exposed code.`,
            'Access LLM credentials only from server-side code and never from Client Components or NEXT_PUBLIC_ variables.',
          ),
        );
      }
    }

    if (node.type === 'StringLiteral') {
      const value = String(node.value);
      if (/^NEXT_PUBLIC_(?:OPENAI|ANTHROPIC)_/i.test(value)) {
        pushFinding(
          findings,
          seen,
          finding(
            'ai-llm-key-in-client',
            'error',
            'high',
            file,
            lineOf(node),
            `'${value}' exposes an LLM credential namespace to the browser bundle.`,
            'Remove the NEXT_PUBLIC_ prefix and keep LLM credentials in server-only environment variables.',
          ),
        );
      }
      if (/^sk-(?:ant-)?[A-Za-z0-9]{8,}/.test(value)) {
        pushFinding(
          findings,
          seen,
          finding(
            'ai-llm-key-in-client',
            'error',
            'high',
            file,
            lineOf(node),
            'Hard-coded LLM secret key pattern (sk-*) found in client-exposed code.',
            'Delete the hard-coded key, rotate it with your provider, and load the replacement from a server-only env var.',
          ),
        );
      }
    }
  });

  return result(findings);
}

export function scanAiRouteAuthz(content: string, file = 'route.ts'): ScanResult {
  const findings: ScannerFinding[] = [];
  if (!isRouteHandlerFile(file)) return result(findings);

  let ast: AstNode;
  try {
    ast = parseCode(content);
  } catch {
    return result(findings);
  }

  let hasLlmCall = LLM_CALL_PATTERNS.some((pattern) => pattern.test(content));
  walk(ast, (node) => {
    if (node.type === 'ImportDeclaration') {
      const source = String(
        (node.source as { value?: unknown } | undefined)?.value ?? '',
      ).toLowerCase();
      if (
        source === 'openai' ||
        source.startsWith('@ai-sdk/') ||
        source.startsWith('@anthropic-ai/')
      ) {
        hasLlmCall = true;
      }
    }
  });

  if (!hasLlmCall) return result(findings);

  const hasAuthGuard = AUTH_GUARD_PATTERNS.some((pattern) => pattern.test(content));
  if (hasAuthGuard) return result(findings);

  return result([
    finding(
      'ai-route-missing-authz',
      'error',
      'medium',
      file,
      1,
      'Route handler invokes an LLM or tool-calling API without an authentication or session guard.',
      'Require an authenticated session (or signed service credential) before calling the model or executing tools.',
    ),
  ]);
}

export function scanAiRateLimit(content: string, file = 'route.ts'): ScanResult {
  const findings: ScannerFinding[] = [];
  if (!isRouteHandlerFile(file) || !isChatStyleRoute(file, content)) {
    return result(findings);
  }

  if (!LLM_CALL_PATTERNS.some((pattern) => pattern.test(content))) {
    return result(findings);
  }

  if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(content))) {
    return result(findings);
  }

  return result([
    finding(
      'ai-missing-rate-limit',
      'warning',
      'medium',
      file,
      1,
      'Chat-style route streams to an LLM without an obvious rate-limit or spend guard.',
      'Add per-user rate limiting and a token/spend budget before exposing model calls on a public route.',
    ),
  ]);
}

export function scanAiPromptInjection(content: string, file = 'route.ts'): ScanResult {
  const findings: ScannerFinding[] = [];
  if (!LLM_CALL_PATTERNS.some((pattern) => pattern.test(content))) {
    return result(findings);
  }

  const injectionPattern =
    /\b(systemPrompt|system_prompt|systemMessage|instructions)\b[\s\S]{0,160}\+\s*(?:body|input|message|prompt)\b/i;

  if (!injectionPattern.test(content)) {
    return result(findings);
  }

  return result([
    finding(
      'ai-prompt-injection-surface',
      'warning',
      'low',
      file,
      1,
      'User-controlled input appears to be concatenated directly into a system or tool prompt.',
      'Treat user input as untrusted data: validate it, keep it out of system prompts, and pass it in a separate user role message.',
    ),
  ]);
}

export function scanAiPiiToModelContext(content: string, file = 'route.ts'): ScanResult {
  const findings: ScannerFinding[] = [];
  if (!LLM_CALL_PATTERNS.some((pattern) => pattern.test(content))) {
    return result(findings);
  }

  const sendsPii =
    /messages\s*:\s*\[[\s\S]*?\b(?:email|phone|address)\b[\s\S]*?\]/i.test(content) ||
    /(?:prompt|content)\s*:\s*[`'"][\s\S]*?\$\{[\s\S]*?(?:email|phone|address)/i.test(content);

  if (!sendsPii) return result(findings);

  const hasRedaction =
    /\b(redact|sanitize|mask|hash|tokenize|pseudonym)/i.test(content) &&
    PII_FIELD_PATTERN.test(content);

  if (hasRedaction) return result(findings);

  return result([
    finding(
      'ai-pii-to-model-context',
      'warning',
      'low',
      file,
      1,
      'User PII fields (email, phone, or address) may be sent to a model context without redaction.',
      'Remove or pseudonymize PII before building model prompts; log only what is strictly necessary.',
    ),
  ]);
}

export function scanAiAppSecurity(content: string, file = 'route.ts'): ScanResult {
  const combined = [
    ...scanAiLlmKeyLeak(content, file).findings,
    ...scanAiRouteAuthz(content, file).findings,
    ...scanAiRateLimit(content, file).findings,
    ...scanAiPromptInjection(content, file).findings,
    ...scanAiPiiToModelContext(content, file).findings,
  ];
  return result(combined);
}
