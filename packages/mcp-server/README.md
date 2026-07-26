# @assurly/mcp-server

**A pre-deploy ship gate your AI agent calls before shipping.** A local stdio [MCP](https://modelcontextprotocol.io) server that lets Cursor, Claude Code, and other MCP clients scan a Next.js + Supabase + Stripe + Vercel project and get one trusted verdict — blockers to fix, warnings to review — _before_ the agent ships to production.

The agent that wrote your app can now check it: **write code → `assurly_scan_path` → fix blockers → re-scan until READY TO SHIP.**

**Your source code never leaves your machine.** The scanning tools run entirely locally over stdio and mirror the `assurly scan` pipeline exactly (`allRules` + detector + Ship Gate report), so an agent scan matches the CLI on the same project. The one tool that talks to the network, `assurly_verdict`, is opt-in and sends only the URL or repo name you ask about — never source.

## Tools

| Tool                   | Description                                                   | Network |
| ---------------------- | ------------------------------------------------------------- | ------- |
| `assurly_scan_path`    | Scan a local project directory                                | Local   |
| `assurly_scan_files`   | Scan in-memory `{ path, content }[]` files                    | Local   |
| `assurly_explain_rule` | Explain a rule id and how to fix it                           | Local   |
| `assurly_verdict`      | Read the hosted ship verdict for a deployed URL or repository | Hosted  |
| `assurly_scan_agent`   | Advisory audit of MCP configs and agent instruction files     | Local   |

`assurly_verdict` returns the status, Ship Score, and top issue, and sets `isError: true` when the verdict is **blocked** — so the agent stops instead of shipping. It requires `ASSURLY_API_KEY` (see [Connect the hosted verdict](#connect-the-hosted-verdict)).

## Requirements

Node `^20.19.0 || >=22.12.0`.

## Install (npm)

Run the server directly with npx — no global install needed:

```bash
npx -y @assurly/mcp-server
```

## Cursor (`.cursor/mcp.json`)

Add this server next to your other MCP entries:

```json
{
  "mcpServers": {
    "assurly": {
      "command": "npx",
      "args": ["-y", "@assurly/mcp-server"]
    }
  }
}
```

After saving, restart Cursor (or reload MCP) and confirm the five `assurly_*` tools appear.

## Claude Code

From your project directory:

```bash
claude mcp add assurly -- npx -y @assurly/mcp-server
```

## VS Code (`.vscode/mcp.json`)

VS Code uses the top-level key `servers`, not `mcpServers`:

```json
{
  "servers": {
    "assurly": {
      "command": "npx",
      "args": ["-y", "@assurly/mcp-server"]
    }
  }
}
```

## Windsurf (`~/.codeium/windsurf/mcp_config.json`)

```json
{
  "mcpServers": {
    "assurly": {
      "command": "npx",
      "args": ["-y", "@assurly/mcp-server"]
    }
  }
}
```

## Any other stdio client

Point the client at `npx` with these arguments:

```json
{
  "command": "npx",
  "args": ["-y", "@assurly/mcp-server"]
}
```

## Connect the hosted verdict

`assurly_verdict` reads the hosted Assurly API — it never scans locally and never triggers an active probe. Create an API key in the Assurly dashboard under **Settings → API keys** (it is shown once), then expose it to the server:

```json
{
  "mcpServers": {
    "assurly": {
      "command": "npx",
      "args": ["-y", "@assurly/mcp-server"],
      "env": {
        "ASSURLY_API_KEY": "your-key-here"
      }
    }
  }
}
```

`ASSURLY_API_URL` is optional and defaults to `https://assurly.dev`. Pass exactly one of `url` or `repo` (in `owner/name` form) when calling the tool.

## Typical agent loop

1. Agent writes or edits code.
2. Call `assurly_scan_path` or `assurly_scan_files`.
3. Read blockers from the Ship Gate summary.
4. Call `assurly_explain_rule` for remediation hints.
5. Fix issues and re-scan until the verdict is **READY TO SHIP**.
6. Before deploying, call `assurly_verdict` — a blocked verdict comes back as an error, so the agent halts rather than shipping.

## Troubleshooting

| Symptom                           | Fix                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Tools do not appear               | Restart the client or reload MCP, then confirm the five `assurly_*` tools are listed.                              |
| `ASSURLY_API_KEY is not set`      | Create a key in the Assurly dashboard (Settings → API keys) and expose it to this MCP server as `ASSURLY_API_KEY`. |
| `invalid or revoked (401)`        | The key is no longer valid. Issue a new one.                                                                       |
| `Provide exactly one of url/repo` | `assurly_verdict` takes one target, not both and not neither.                                                      |
| Server fails to start             | Check your Node version against the requirement above.                                                             |

## Build from source (contributors)

If you are working on this repository directly, build and point your MCP client at the local output:

From the repo root:

```bash
npm run build -w assurly
npm run build -w @assurly/mcp-server
```

Run (stdio):

```bash
node packages/mcp-server/dist/index.js
```

Cursor (`.cursor/mcp.json`) with an absolute path to your clone:

```json
{
  "mcpServers": {
    "assurly": {
      "command": "node",
      "args": ["/absolute/path/to/assurly/packages/mcp-server/dist/index.js"]
    }
  }
}
```

Claude Code:

```bash
claude mcp add assurly -- node /absolute/path/to/assurly/packages/mcp-server/dist/index.js
```

Replace `/absolute/path/to/assurly` with the path to this repository on your machine.
