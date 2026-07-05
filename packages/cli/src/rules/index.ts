import { Rule } from '../types';
import { envRules } from './envRules';
import { supabaseRules } from './supabaseRules';
import { stripeRules } from './stripeRules';
import { vercelRules } from './vercelRules';
import { ciRules } from './ciRules';
import { tsconfigRules } from './tsconfigRules';
import { dbPoolRules } from './dbPoolRules';
import { rscRules } from './rscRules';
import { coldStartRules } from './coldStartRules';
import { sqlSafetyRules } from './sqlSafetyRules';
import { deeperStackRules } from './deeperStackRules';

/**
 * Array containing all static analysis rules implemented in ShipReady.
 */
export const allRules: Rule[] = [
  envRules,
  supabaseRules,
  stripeRules,
  vercelRules,
  ciRules,
  tsconfigRules,
  dbPoolRules,
  rscRules,
  coldStartRules,
  sqlSafetyRules,
  deeperStackRules,
];
