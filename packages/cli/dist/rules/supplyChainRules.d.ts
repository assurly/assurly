import { Rule } from '../types';
/**
 * Install-time trust — audits npm 12+ allowScripts / lockfile install scripts /
 * non-registry deps. Runs in every scan by default (offline, cheap). Individual
 * findings keep their scanner-core rule ids; this wrapper id is never a ship
 * blocker.
 *
 * See packages/scanner-core/src/supplyChain.ts for the product decision that
 * every `supply-*` finding is warning-only.
 */
export declare const supplyChainRules: Rule;
