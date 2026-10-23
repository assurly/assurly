"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.languageCoverageRules = void 0;
const scanner_core_1 = require("@assurly/scanner-core");
/**
 * Payment or login code in a language Assurly cannot read. The dashboard has
 * always said so; the CLI did not, so it called Attesta (Go backend with
 * Stripe and auth) "REVIEW RECOMMENDED 92" where the dashboard said "CAN'T
 * CALL IT YET". Same files, same verdict, whichever channel ran the scan.
 */
exports.languageCoverageRules = {
    id: scanner_core_1.SCAN_LANGUAGE_COVERAGE_RULE_ID,
    name: 'Unread Language Coverage',
    description: 'Reports payment and authentication code in languages the rules cannot read.',
    severity: 'warning',
    async run(context) {
        const paths = (0, scanner_core_1.languageCoveragePaths)(context.files);
        const finding = (0, scanner_core_1.unanalyzedSourceFinding)((0, scanner_core_1.summarizeUnanalyzedSource)(paths));
        return finding ? [finding] : [];
    },
};
