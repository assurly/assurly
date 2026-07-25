# MCP Directory Submissions

Publishing `@assurly/mcp-server` to npm makes it _installable_. Getting it into
the MCP directories is what makes it **discoverable** — this is where Cursor /
Claude Code users actually find MCP servers, and it is free distribution to
exactly Assurly's "AI agents" segment.

Do this **after** the npm publish (the directories link to the published package)
and after the `/mcp` page is live.

> Directory names, URLs, and submission mechanics change often. Verify each one's
> current process before submitting; the steps below are the shape, not a
> guarantee.

## Prerequisites (must be true before submitting)

- [ ] `@assurly/mcp-server` is published to npm. **Note:** these packages are
      published _without_ provenance on purpose — npm cannot verify a provenance
      attestation that points at a private repository, so signing it would show a
      warning rather than the green badge. Do not treat a missing provenance badge
      as a blocker; see the comments in `.github/workflows/package-release.yml`.
- [ ] `npx -y @assurly/mcp-server` starts cleanly for a stranger (no repo, no build).
- [ ] The package README sells the value in the first paragraph and has copy-paste
      config for Cursor, Claude Code, VS Code, and Windsurf (done).
- [ ] `keywords` include `mcp`, `model-context-protocol`, `cursor`, `claude-code`
      (done in `package.json`).
- [ ] `https://assurly.dev/mcp` is live and reachable.
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
| **awesome-mcp-servers** (GitHub)                            | The reference "awesome" list                        | Open a PR adding Assurly under the security/testing category                                                  |
| **Cursor Directory** (cursor.directory)                     | Cursor-specific MCP + rules directory               | Submit via its contribution flow                                                                              |
| **Windsurf MCP registry**                                   | Windsurf's in-app MCP marketplace                   | See the note below — this listing is the only way to earn an "Add to Windsurf" button                         |

## Why the Windsurf listing is worth chasing

`/mcp` shows one-click install buttons for Cursor and VS Code only, because those
are the two clients whose URL handler accepts an arbitrary server config
(`cursor://anysphere.cursor-deeplink/mcp/install?config=…` and
`https://vscode.dev/redirect/mcp/install?config=…`).

Windsurf's deeplink is different: `windsurf://windsurf-mcp-registry?serverName=…`
only **opens the registry page for a server already in their marketplace** — it
cannot install from a payload. So an "Add to Windsurf" button is impossible until
Assurly is listed there, and shipping one before that would point users at a page
that does not exist.

Getting listed therefore buys a real feature, not just a backlink. Once it lands,
add the button to `OneClickInstall.tsx` and drop Windsurf from the explanatory
note under the buttons.

Claude Code will never get a button: it is a CLI, and `claude mcp add …` is a
terminal command with no URL handler behind it. That is a permanent limitation,
not a gap to close.

## Submission content (reuse across all of them)

- **Name:** Assurly
- **Package:** `@assurly/mcp-server`
- **Install:** `npx -y @assurly/mcp-server`
- **Category:** Security / Code quality / Testing
- **One-liner:** see the pitch above
- **Tools:** `assurly_scan_path`, `assurly_scan_files`, `assurly_explain_rule`,
  `assurly_verdict`
- **Differentiator worth stating in the listing:** a blocked `assurly_verdict`
  returns `isError: true`, so the agent halts instead of shipping — it is a gate,
  not a suggestion.
- **Config snippet** (identical to the README and `/mcp` page):
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
- **Homepage:** https://assurly.dev/mcp
- **Repo:** https://github.com/assurly/assurly

## After listing

- [ ] Verify each listing renders the README and the install command correctly.
- [ ] Add the directory badges/links to `assurly.dev/mcp` if they offer them
      (social proof + backlinks).
- [ ] Keep the version current — directories that read npm will reflect new
      releases automatically; manually-curated lists may need a nudge on a major
      update.
