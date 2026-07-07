# MCP Directory Submissions

Publishing `@shipready/mcp-server` to npm makes it _installable_. Getting it into
the MCP directories is what makes it **discoverable** — this is where Cursor /
Claude Code users actually find MCP servers, and it is free distribution to
exactly ShipReady's "AI agents" segment.

Do this **after** the npm publish (the directories link to the published package)
and after the `/mcp` page is live.

> Directory names, URLs, and submission mechanics change often. Verify each one's
> current process before submitting; the steps below are the shape, not a
> guarantee.

## Prerequisites (must be true before submitting)

- [ ] `@shipready/mcp-server` is published to npm with provenance (the green
      "provenance" badge shows on the npm page).
- [ ] `npx -y @shipready/mcp-server` starts cleanly for a stranger (no repo, no build).
- [ ] The package README sells the value in the first paragraph and has copy-paste
      Cursor + Claude Code config (done).
- [ ] `keywords` include `mcp`, `model-context-protocol`, `cursor`, `claude-code`
      (done in `package.json`).
- [ ] `https://shipready.dev/mcp` is live and reachable.
- [ ] A one-line pitch is ready: _"A pre-deploy ship gate your AI agent calls
      before shipping — scans Next.js + Supabase + Stripe + Vercel for what will
      break in production."_

## Directories to submit to

| Directory                                                   | What it is                                          | How submissions typically work                                                                                |
| ----------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Official MCP Registry** (`modelcontextprotocol/registry`) | The canonical, first-party registry AI clients read | Add a `server.json` / publish via the registry's CLI per its current docs; this is the highest-signal listing |
| **Smithery** (smithery.ai)                                  | Popular hosted MCP catalog + one-click installs     | Connect the GitHub repo; it reads the package + README                                                        |
| **mcp.so**                                                  | Large community MCP directory                       | Submit the repo/npm package via its "submit" flow                                                             |
| **Glama** (glama.ai/mcp)                                    | MCP server directory with quality signals           | Submit repo; it indexes README + npm                                                                          |
| **PulseMCP** (pulsemcp.com)                                 | Curated MCP server list + newsletter                | Submit via its add-server form                                                                                |
| **awesome-mcp-servers** (GitHub)                            | The reference "awesome" list                        | Open a PR adding ShipReady under the security/testing category                                                |
| **Cursor Directory** (cursor.directory)                     | Cursor-specific MCP + rules directory               | Submit via its contribution flow                                                                              |

## Submission content (reuse across all of them)

- **Name:** ShipReady
- **Package:** `@shipready/mcp-server`
- **Install:** `npx -y @shipready/mcp-server`
- **Category:** Security / Code quality / Testing
- **One-liner:** see the pitch above
- **Tools:** `shipready_scan_path`, `shipready_scan_files`, `shipready_explain_rule`
- **Config snippet** (identical to the README and `/mcp` page):
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
- **Homepage:** https://shipready.dev/mcp
- **Repo:** https://github.com/shipready/shipready

## After listing

- [ ] Verify each listing renders the README and the install command correctly.
- [ ] Add the directory badges/links to `shipready.dev/mcp` if they offer them
      (social proof + backlinks).
- [ ] Keep the version current — directories that read npm will reflect new
      releases automatically; manually-curated lists may need a nudge on a major
      update.
