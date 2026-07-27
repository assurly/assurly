# @assurly/mcp-server

**A pre-deploy ship gate your AI agent calls before shipping.** A local stdio [MCP](https://modelcontextprotocol.io) server that lets Cursor, Claude Code, and other MCP clients scan a Next.js + Supabase + Stripe + Vercel project and get one trusted verdict — blockers to fix, warnings to review — _before_ the agent ships to production.

The agent that wrote your app can now check it: **write code → `assurly_scan_path` → fix blockers → re-scan until READY TO SHIP.**

**Your source code never leaves your machine.** The scanning tools run entirely locally over stdio and mirror the `assurly scan` pipeline exactly (`allRules` + detector + Ship Gate report), so an agent scan matches the CLI on the same project. The one tool that talks to the network, `assurly_verdict`, is opt-in and sends only the URL or repo name you ask about — never source.

## In short

`@assurly/mcp-server` is a local stdio MCP server that gives an AI coding agent a
pre-deploy ship gate. It exposes five tools: scan a project directory, scan in-memory
files, explain a rule id, read a hosted verdict for a deployed URL or repository, and
audit the agent's own stack. A blocked verdict is returned with `isError: true`, so the
agent stops instead of shipping. Install it with `npx -y @assurly/mcp-server`; it works
with Cursor, Claude Code, VS Code and Windsurf.

## Can a scanner check the agent's own setup?

`assurly_scan_agent` does. It reads the MCP client configuration and the instruction files
an agent is given — `.cursor/mcp.json`, `.vscode/mcp.json`, `README.md`, `CLAUDE.md`,
`AGENTS.md`, `.cursorrules`, pull-request and issue templates — and reports eight classes
of problem:

> An MCP server configured to run `bash` or pipe a download into a shell can execute
> arbitrary code from the agent session. A remote MCP endpoint on plain `http://` exposes
> tool traffic and credentials in transit. A credential written directly into an MCP `env`
> block is usually committed or synced. And an instruction file can carry directives that a
> reader never sees but a model always does — hidden inside an HTML comment or zero-width
> characters — including text that tries to override the agent's prior instructions or tell
> it to send `.env` contents to a remote endpoint.

These are advisory: they audit the developer's tooling rather than the application being
deployed, so they never block a ship verdict.

## Tools

| Tool                   | Description                                                   | Network |
| ---------------------- | ------------------------------------------------------------- | ------- |
| `assurly_scan_path`    | Scan a local project directory                                | Local   |
| `assurly_scan_files`   | Scan in-memory `{ path, content }[]` files                    | Local   |
| `assurly_explain_rule` | Explain a rule id and how to fix it                           | Local   |
| `assurly_verdict`      | Read the hosted ship verdict for a deployed URL or repository | Hosted  |
| `assurly_scan_agent`   | Advisory audit of MCP configs and agent instruction files     | Local   |

`assurly_verdict` returns the status, Ship Score, and top issue, and sets `isError: true` when the verdict is **blocked** — so the agent stops instead of shipping. It requires `ASSURLY_API_KEY` (see [Connect the hosted verdict](#connect-the-hosted-verdict)).

## How do I stop my AI agent from deploying broken code?

Give it a gate it must call, and make a failed gate an error rather than a suggestion.

> [The MCP specification](https://modelcontextprotocol.io/specification) lets a tool return
> `isError: true`, and agents treat that as a failed call rather than a result to interpret.
> Assurly uses it deliberately: a **blocked** verdict comes back as an error, so the agent
> stops and reports instead of deciding for itself whether the finding matters. Advisory
> findings never set it — a gate that errors on everything is a gate the agent learns to
> work around.

Paste the rules from [assurly.dev/mcp](https://assurly.dev/mcp) into `.cursorrules`,
`CLAUDE.md` or `AGENTS.md` so the agent calls the gate before every deploy without being
asked.

## Does my source code leave my machine?

No, for the four local tools. `assurly_scan_path` and `assurly_scan_files` run the rules in
this process over stdio, and `assurly_explain_rule` is a lookup. The fifth tool,
`assurly_verdict`, is the only one that reaches the network, and it sends only the URL or
repository name you ask about — never file contents. It is opt-in: without
`ASSURLY_API_KEY` it does nothing.

## Which MCP clients does this work with?

Any client that speaks stdio MCP. Configuration examples below cover Cursor, Claude Code,
VS Code and Windsurf. Note that VS Code uses a `servers` key where Cursor and Windsurf use
`mcpServers` — copying a config between them without renaming that key is the most common
reason a server appears not to load.

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
