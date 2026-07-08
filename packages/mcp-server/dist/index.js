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
  "assurly_explain_rule"
];
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
