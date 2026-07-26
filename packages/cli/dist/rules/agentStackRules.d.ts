import { Rule } from '../types';
/**
 * Agent Stack — audits MCP client configs and instruction files the AI agent
 * reads. Runs in every scan by default (offline, cheap). Individual findings
 * keep their scanner-core rule ids; this wrapper id is never a ship blocker.
 *
 * See packages/scanner-core/src/agentStack.ts for the product decision that
 * `agent-*` findings must never gate deploy.
 */
export declare const agentStackRules: Rule;
