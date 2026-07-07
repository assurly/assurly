# @shipready/mcp-server

**A pre-deploy ship gate your AI agent calls before shipping.** A local stdio [MCP](https://modelcontextprotocol.io) server that lets Cursor, Claude Code, and other MCP clients scan a Next.js + Supabase + Stripe + Vercel project and get one trusted verdict — blockers to fix, warnings to review — _before_ the agent ships to production.

The agent that wrote your app can now check it: **write code → `shipready_scan_path` → fix blockers → re-scan until READY TO SHIP.**

Everything runs locally over stdio. Your source code is never uploaded — the tools mirror the `shipready scan` pipeline exactly (`allRules` + detector + Ship Gate report), so an agent scan matches the CLI on the same project.

## Tools

| Tool                     | Description                                |
| ------------------------ | ------------------------------------------ |
| `shipready_scan_path`    | Scan a local project directory             |
| `shipready_scan_files`   | Scan in-memory `{ path, content }[]` files |
| `shipready_explain_rule` | Explain a rule id and how to fix it        |

## Install (npm)

After the package is published to the public npm registry:

```bash
npx -y @shipready/mcp-server
```

## Cursor (`.cursor/mcp.json`)

Add this server next to your other MCP entries:

```json
{
  "mcpServers": {
    "shipready": {
      "command": "npx",
      "args": ["-y", "@shipready/mcp-server"]
    }
  }
}
```

After saving, restart Cursor (or reload MCP) and confirm the three `shipready_*` tools appear.

## Claude Code

From your project directory:

```bash
claude mcp add shipready -- npx -y @shipready/mcp-server
```

## Typical agent loop

1. Agent writes or edits code.
2. Call `shipready_scan_path` or `shipready_scan_files`.
3. Read blockers from the Ship Gate summary.
4. Call `shipready_explain_rule` for remediation hints.
5. Fix issues and re-scan until the verdict is **READY TO SHIP**.

## Build from source (contributors)

If you are working on this repository directly, build and point your MCP client at the local output:

From the repo root:

```bash
npm run build -w @shipready/cli
npm run build -w @shipready/mcp-server
```

Run (stdio):

```bash
node packages/mcp-server/dist/index.js
```

Cursor (`.cursor/mcp.json`) with an absolute path to your clone:

```json
{
  "mcpServers": {
    "shipready": {
      "command": "node",
      "args": ["/absolute/path/to/shipready/packages/mcp-server/dist/index.js"]
    }
  }
}
```

Claude Code:

```bash
claude mcp add shipready -- node /absolute/path/to/shipready/packages/mcp-server/dist/index.js
```

Replace `/absolute/path/to/shipready` with the path to this repository on your machine.
