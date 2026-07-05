import { describe, expect, it } from 'vitest';
import { buildShipGateReport } from './shipGate';
import {
  scanAiLlmKeyLeak,
  scanAiPiiToModelContext,
  scanAiPromptInjection,
  scanAiRateLimit,
  scanAiRouteAuthz,
} from './aiAppSecurity';

describe('scanAiLlmKeyLeak', () => {
  it('flags OPENAI_API_KEY in a client component as a high-confidence blocker', () => {
    const code = `'use client';\nconst key = process.env.OPENAI_API_KEY;`;
    const result = scanAiLlmKeyLeak(code, 'components/Chat.tsx');

    expect(result.errorCount).toBe(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: 'ai-llm-key-in-client',
      severity: 'error',
      confidence: 'high',
    });
  });

  it('does not flag server-only LLM env usage', () => {
    const code = `export async function POST() {\n  return process.env.OPENAI_API_KEY;\n}`;
    expect(scanAiLlmKeyLeak(code, 'app/api/chat/route.ts').findings).toEqual([]);
  });

  it('flags NEXT_PUBLIC LLM env names in example files', () => {
    const code = `NEXT_PUBLIC_OPENAI_API_KEY=abc`;
    const result = scanAiLlmKeyLeak(code, '.env.example');

    expect(result.errorCount).toBe(1);
    expect(result.findings[0]?.ruleId).toBe('ai-llm-key-in-client');
  });
});

describe('scanAiRouteAuthz', () => {
  it('flags LLM routes without an auth guard as medium-confidence review findings', () => {
    const code = [
      "import OpenAI from 'openai';",
      'const openai = new OpenAI();',
      'export async function POST(req: Request) {',
      '  const body = await req.json();',
      '  return openai.chat.completions.create({ messages: body.messages });',
      '}',
    ].join('\n');

    const result = scanAiRouteAuthz(code, 'app/api/chat/route.ts');
    expect(result.findings[0]).toMatchObject({
      ruleId: 'ai-route-missing-authz',
      severity: 'error',
      confidence: 'medium',
    });

    // error + medium confidence -> review bucket, not a blocker and not a
    // plain warning (see shipGate.ts isReviewFinding).
    const report = buildShipGateReport(result.findings);
    expect(report.blockers).toHaveLength(0);
    expect(report.reviews.some((group) => group.id === 'rule:ai-route-missing-authz')).toBe(true);
  });

  it('passes when a session guard is present', () => {
    const code = [
      "import OpenAI from 'openai';",
      'export async function POST(req: Request) {',
      '  const session = await getServerSession();',
      '  if (!session) return new Response(null, { status: 401 });',
      '  const openai = new OpenAI();',
      '  return openai.chat.completions.create({ messages: [] });',
      '}',
    ].join('\n');

    expect(scanAiRouteAuthz(code, 'app/api/chat/route.ts').findings).toEqual([]);
  });
});

describe('scanAiRateLimit', () => {
  it('warns on chat routes without a rate-limit guard', () => {
    const code = [
      "import { streamText } from 'ai';",
      'export async function POST() {',
      '  return streamText({ model: "gpt-4o", prompt: "hi" });',
      '}',
    ].join('\n');

    expect(scanAiRateLimit(code, 'app/api/chat/route.ts').findings[0]).toMatchObject({
      ruleId: 'ai-missing-rate-limit',
      severity: 'warning',
      confidence: 'medium',
    });
  });

  it('passes when a rate limit helper is present', () => {
    const code = [
      "import { streamText } from 'ai';",
      'export async function POST() {',
      '  await rateLimit(userId);',
      '  return streamText({ model: "gpt-4o", prompt: "hi" });',
      '}',
    ].join('\n');

    expect(scanAiRateLimit(code, 'app/api/chat/route.ts').findings).toEqual([]);
  });
});

describe('scanAiPromptInjection', () => {
  it('emits a low-confidence warning for raw user prompt concatenation', () => {
    const code = [
      "import { generateText } from 'ai';",
      'export async function POST(req: Request) {',
      '  const body = await req.json();',
      '  const systemPrompt = "You are helpful. " + body.prompt;',
      '  return generateText({ prompt: systemPrompt });',
      '}',
    ].join('\n');

    const finding = scanAiPromptInjection(code, 'app/api/chat/route.ts').findings[0];
    expect(finding).toMatchObject({
      ruleId: 'ai-prompt-injection-surface',
      severity: 'warning',
      confidence: 'low',
    });

    const report = buildShipGateReport([finding!]);
    expect(report.blockers).toHaveLength(0);
  });
});

describe('scanAiPiiToModelContext', () => {
  it('emits a low-confidence warning when PII is sent to the model', () => {
    const code = [
      "import { generateText } from 'ai';",
      'export async function POST(req: Request) {',
      '  const { email, phone } = await req.json();',
      '  return generateText({ prompt: `User email ${email} phone ${phone}` });',
      '}',
    ].join('\n');

    const finding = scanAiPiiToModelContext(code, 'app/api/support/route.ts').findings[0];
    expect(finding).toMatchObject({
      ruleId: 'ai-pii-to-model-context',
      severity: 'warning',
      confidence: 'low',
    });

    const report = buildShipGateReport([finding!]);
    expect(report.blockers).toHaveLength(0);
  });
});
