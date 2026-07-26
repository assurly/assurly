#!/usr/bin/env node
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  ASSURLY_MCP_TOOL_NAMES: () => ASSURLY_MCP_TOOL_NAMES,
  createAssurlyMcpServer: () => createAssurlyMcpServer
});
module.exports = __toCommonJS(index_exports);
var import_fs = require("fs");
var import_path = require("path");
var import_mcp = require("@modelcontextprotocol/sdk/server/mcp.js");
var import_stdio = require("@modelcontextprotocol/sdk/server/stdio.js");
var import_zod = require("zod");

// src/tools.ts
var import_ruleExplainer = require("assurly/ruleExplainer");
var import_scanProject = require("assurly/scanProject");
var ASSURLY_MCP_TOOL_NAMES = [
  "assurly_scan_path",
  "assurly_scan_files",
  "assurly_explain_rule",
  "assurly_verdict",
  "assurly_scan_agent"
];
function formatFixOutcomesText(outcomes) {
  if (outcomes.length === 0) {
    return "Fix outcomes: none recorded yet. After deploying a claimed fix, re-probe before treating it as done.";
  }
  const lines = outcomes.map((entry) => {
    const ruleId = entry.ruleId ?? "unknown-rule";
    const outcome = entry.outcome ?? "unknown";
    const when = entry.observedAt ?? "unknown time";
    return `  \xB7 ${ruleId}: ${outcome} \xB7 observed ${when}`;
  });
  return [
    "Fix outcomes (last re-probe only \u2014 may predate your latest edit):",
    ...lines,
    "Not yet verified against your latest changes \u2014 deploy and re-probe. An unverified claim is not done."
  ].join("\n");
}
function formatScanToolResult(result) {
  const payload = {
    verdict: result.report.headline,
    status: result.report.status,
    shipScore: result.report.shipScore,
    blockers: result.report.blockers,
    reviews: result.report.reviews,
    warnings: result.report.warnings,
    findings: result.findings,
    detectedStack: result.context.detectedStack,
    scanScope: result.context.scanScope,
    report: result.report
  };
  return {
    content: [
      {
        type: "text",
        text: result.summary
      },
      {
        type: "text",
        text: `Markdown report:

${result.markdown}`
      },
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}
async function handleScanPath(input) {
  const result = await (0, import_scanProject.scanProjectDirectory)(input.path);
  return formatScanToolResult(result);
}
async function handleScanFiles(input) {
  const result = await (0, import_scanProject.scanProjectFiles)(input.files);
  return formatScanToolResult(result);
}
async function handleScanAgent(input) {
  const result = await (0, import_scanProject.scanProjectDirectory)(input.path, { agentOnly: true });
  const formatted = formatScanToolResult(result);
  return { ...formatted, isError: false };
}
function errorResult(text) {
  return { content: [{ type: "text", text }], isError: true };
}
async function handleVerdict(input, config) {
  const hasUrl = typeof input.url === "string" && input.url.length > 0;
  const hasRepo = typeof input.repo === "string" && input.repo.length > 0;
  if (hasUrl === hasRepo) {
    return errorResult("Provide exactly one of `url` or `repo`.");
  }
  if (!config.apiKey) {
    return errorResult(
      "ASSURLY_API_KEY is not set. Create a key in the Assurly dashboard (Settings \u2192 API keys) and expose it to this MCP server as ASSURLY_API_KEY."
    );
  }
  const doFetch = config.fetchImpl ?? fetch;
  const base = config.apiUrl.replace(/\/$/, "");
  const query = hasUrl ? `url=${encodeURIComponent(input.url)}` : `repo=${encodeURIComponent(input.repo)}`;
  let response;
  try {
    response = await doFetch(`${base}/api/v1/verdict?${query}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.apiKey}`
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Could not reach the Assurly API: ${message}`);
  }
  if (response.status === 401) {
    return errorResult("The Assurly API key is invalid or revoked (401). Issue a new key.");
  }
  if (!response.ok) {
    return errorResult(`The Assurly API returned an error (${response.status}).`);
  }
  const verdict = await response.json();
  const status = verdict.status ?? "unknown";
  const score = typeof verdict.shipScore === "number" ? `${verdict.shipScore}/100` : "n/a";
  const shipReady = status === "ready";
  const fixOutcomes = Array.isArray(verdict.fixOutcomes) ? verdict.fixOutcomes : [];
  const lines = [
    `Assurly verdict: ${status.toUpperCase()} \xB7 Ship Score ${score}`,
    verdict.displayName || verdict.identifier ? `Target: ${verdict.displayName ?? verdict.identifier}` : "",
    shipReady ? "No blocking issues detected \u2014 safe to ship." : verdict.topIssue ? `Top issue: ${verdict.topIssue.category ?? "Security issue"}${verdict.topIssue.remediation ? ` \u2014 ${verdict.topIssue.remediation}` : ""}` : status === "unknown" ? "No published verdict for this target yet. Scan it in Assurly first." : "Review the issues in the Assurly dashboard before shipping.",
    formatFixOutcomesText(fixOutcomes),
    verdict.trustPageUrl ? `Trust page: ${verdict.trustPageUrl}` : ""
  ].filter((line) => line.length > 0);
  return {
    content: [
      { type: "text", text: lines.join("\n") },
      { type: "text", text: JSON.stringify(verdict, null, 2) }
    ],
    // Blocked status is the only ship-gate halt. See docstring for why fix
    // outcomes never widen isError.
    isError: status === "blocked"
  };
}
function handleExplainRule(input) {
  const explanation = (0, import_ruleExplainer.explainRule)(input.ruleId);
  if (!explanation) {
    return {
      content: [
        {
          type: "text",
          text: `Unknown rule id: ${input.ruleId}`
        }
      ],
      isError: true
    };
  }
  const text = [
    `# ${explanation.title}`,
    "",
    `Rule ID: ${explanation.ruleId}`,
    `Blocks ship when high-confidence: ${explanation.blocksShip ? "yes" : "no"}`,
    "",
    "## What this rule checks",
    explanation.explanation,
    "",
    "## How to fix",
    explanation.howToFix
  ].join("\n");
  return {
    content: [
      {
        type: "text",
        text
      },
      {
        type: "text",
        text: JSON.stringify(explanation, null, 2)
      }
    ]
  };
}

// src/index.ts
var DEFAULT_ASSURLY_API_URL = "https://assurly.dev";
function getPackageVersion() {
  try {
    const pkg = JSON.parse((0, import_fs.readFileSync)((0, import_path.join)(__dirname, "../package.json"), "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
function createAssurlyMcpServer() {
  const server = new import_mcp.McpServer(
    {
      name: "assurly",
      version: getPackageVersion()
    },
    {
      instructions: "Assurly Ship Gate MCP server. Scan local projects before deploy and explain blockers so agents can remediate until READY TO SHIP."
    }
  );
  server.registerTool(
    "assurly_scan_path",
    {
      title: "Scan project directory",
      description: "Run the full Assurly Ship Gate scan on a local project directory (same rules as `assurly scan`).",
      inputSchema: {
        path: import_zod.z.string().describe("Absolute or relative path to the project root to scan")
      }
    },
    async ({ path: projectPath }) => handleScanPath({ path: projectPath })
  );
  server.registerTool(
    "assurly_scan_files",
    {
      title: "Scan provided files",
      description: "Run the Assurly Ship Gate scan on in-memory file contents (for agents that already have project files in context).",
      inputSchema: {
        files: import_zod.z.array(
          import_zod.z.object({
            path: import_zod.z.string().describe("Project-relative file path"),
            content: import_zod.z.string().describe("File contents")
          })
        ).min(1).describe("Files to analyze")
      }
    },
    async ({ files }) => handleScanFiles({ files })
  );
  server.registerTool(
    "assurly_explain_rule",
    {
      title: "Explain an Assurly rule",
      description: "Return a human-readable explanation and remediation steps for an Assurly Ship Gate rule id (e.g. supabase-rls).",
      inputSchema: {
        ruleId: import_zod.z.string().describe("Assurly rule identifier")
      }
    },
    async ({ ruleId }) => handleExplainRule({ ruleId })
  );
  server.registerTool(
    "assurly_verdict",
    {
      title: "Get the hosted Assurly ship verdict",
      description: "Pre-deploy ship gate: read the hosted Assurly verdict (Ready/Review/Blocked + ship score + top issue + one-line fix + per-rule fix outcomes with observation times) for a deployed URL or a repo. Fix outcomes reflect the last re-probe only \u2014 after claiming a fix, deploy and re-probe before treating it as done. Reads the hosted Assurly API \u2014 it does not scan locally and never triggers an active probe. Requires ASSURLY_API_KEY in the environment.",
      inputSchema: {
        url: import_zod.z.string().url().optional().describe("Deployed app URL to look up (exactly one of url/repo)"),
        repo: import_zod.z.string().optional().describe("Repository in owner/name form to look up (exactly one of url/repo)")
      }
    },
    async ({ url, repo }) => handleVerdict(
      { url, repo },
      {
        apiUrl: process.env.ASSURLY_API_URL?.trim() || DEFAULT_ASSURLY_API_URL,
        apiKey: process.env.ASSURLY_API_KEY?.trim() || void 0
      }
    )
  );
  server.registerTool(
    "assurly_scan_agent",
    {
      title: "Scan the agent stack",
      description: "Advisory audit of the AI agent setup only \u2014 MCP client configs (.cursor/mcp.json, etc.) and instruction files (README, CLAUDE.md, AGENTS.md, .cursorrules). Does not scan application source. Never blocks ship; isError stays false under all outcomes.",
      inputSchema: {
        path: import_zod.z.string().describe("Absolute or relative path to the project root to scan")
      }
    },
    async ({ path: projectPath }) => handleScanAgent({ path: projectPath })
  );
  return server;
}
async function main() {
  const server = createAssurlyMcpServer();
  const transport = new import_stdio.StdioServerTransport();
  await server.connect(transport);
}
if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Assurly MCP server failed: ${message}`);
    process.exit(1);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ASSURLY_MCP_TOOL_NAMES,
  createAssurlyMcpServer
});
