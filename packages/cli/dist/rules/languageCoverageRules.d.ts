import { Rule } from '../types';
/**
 * Payment or login code in a language Assurly cannot read. The dashboard has
 * always said so; the CLI did not, so it called Attesta (Go backend with
 * Stripe and auth) "REVIEW RECOMMENDED 92" where the dashboard said "CAN'T
 * CALL IT YET". Same files, same verdict, whichever channel ran the scan.
 */
export declare const languageCoverageRules: Rule;
