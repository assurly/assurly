/**
 * Counts that describe the shipped product, stated once.
 *
 * These are quoted on the marketing page, in the FAQ, and in the structured data
 * a crawler reads, so they cannot live next to any one of those. They are
 * literals rather than derived values because the packages are built artefacts
 * the web app does not import at runtime — ProofPoints.test.tsx closes that gap
 * by reading the package sources and failing when a number here falls behind.
 */

/** Rule areas in packages/cli/src/rules/index.ts (`allRules`). */
export const RULE_AREA_COUNT = 13;

/** Tools in packages/mcp-server/src/tools.ts (`ASSURLY_MCP_TOOL_NAMES`). */
export const MCP_TOOL_COUNT = 5;
