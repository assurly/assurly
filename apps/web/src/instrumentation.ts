import { assertProductionStripeConfig, assertProductionSupabaseConfig } from './utils/env';

export function register(): void {
  assertProductionSupabaseConfig();
  assertProductionStripeConfig();
}
