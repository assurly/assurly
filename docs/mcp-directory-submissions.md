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

- [x] `@assurly/mcp-server` is published to npm. **Note:** these packages are
      published _without_ provenance on purpose — npm cannot verify a provenance
      attestation that points at a private repository, so signing it would show a
      warning rather than the green badge. Do not treat a missing provenance badge
      as a blocker; see the comments in `.github/workflows/package-release.yml`.
- [x] `npx -y @assurly/mcp-server` starts cleanly for a stranger (no repo, no build).
      Verified 2026-07-27 against the published 1.2.1: a raw `initialize` request over
      stdio returns `serverInfo.name = "assurly"` and the tool capability.
- [x] The package README sells the value in the first paragraph and has copy-paste
      config for Cursor, Claude Code, VS Code, and Windsurf (done).
- [x] `keywords` include `mcp`, `model-context-protocol`, `cursor`, `claude-code`
      (done in `package.json`).
- [ ] `https://assurly.dev/mcp` is live and reachable. **This is the only one still
      open.** Several directories fetch the homepage when a submission is reviewed, and
      a curated list is hard to re-enter after a bad first impression — so submit
      nothing until this returns a page rather than a deployment error.
- [x] A one-line pitch is ready: _"A pre-deploy ship gate your AI agent calls
      before shipping — scans Next.js + Supabase + Stripe + Vercel for what will
      break in production."_

## Directories to submit to

| Directory                                                   | What it is                                          | How submissions typically work                                                                                                                     |
| ----------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Official MCP Registry** (`modelcontextprotocol/registry`) | The canonical, first-party registry AI clients read | `mcp-publisher init` → `login` → `publish`. **Do this first** — see below; it is the highest-signal listing and the private repo does not block it |
| **Smithery** (smithery.ai)                                  | Popular hosted MCP catalog + one-click installs     | Connect the GitHub repo; it reads the package + README                                                                                             |
| **mcp.so**                                                  | Large community MCP directory                       | Submit the repo/npm package via its "submit" flow                                                                                                  |
| **Glama** (glama.ai/mcp)                                    | MCP server directory with quality signals           | Submit repo; it indexes README + npm                                                                                                               |
| **PulseMCP** (pulsemcp.com)                                 | Curated MCP server list + newsletter                | Submit via its add-server form                                                                                                                     |
| **awesome-mcp-servers** (GitHub)                            | The reference "awesome" list                        | Open a PR adding Assurly under the security/testing category                                                                                       |
| **Cursor Directory** (cursor.directory)                     | Cursor-specific MCP + rules directory               | Submit via its contribution flow                                                                                                                   |
| **Windsurf MCP registry**                                   | Windsurf's in-app MCP marketplace                   | **No public submission process exists** — see below. Ask them directly                                                                             |

## Start with the official registry

It is the only listing that needs no public repository, which makes it the one to
do first.

```sh
mcp-publisher init      # generates server.json, with auto-detection
mcp-publisher login dns # or: github / github-oidc / http
mcp-publisher publish
```

The registry validates that a publisher owns the namespace it claims.
`io.github.<user>/<server>` requires GitHub authentication as that user;
`<domain>/<server>` requires proving control of the domain. Assurly owns
`assurly.dev`, so a **DNS TXT record** claims `dev.assurly/...` without the
repository being public.

`github-oidc` authenticates from inside a GitHub Actions workflow, so publishing
can be wired into `package-release.yml` and stay current with each version rather
than being re-done by hand.

## Windsurf has no submission form

Verified against Windsurf's own documentation (2026-07-27): it describes how a
_user_ adds servers — through the marketplace, or by hand in `mcp_config.json` —
and documents no route for a server author to be listed. The marketplace marks
first-party entries with a blue checkmark, which reads like a curated list rather
than an open submission queue.

An earlier version of this document assumed a submission flow existed. It does
not. The realistic path is to contact Windsurf directly, with the published
package, the five tools and a working `initialize` response as the argument.

(Windsurf's documentation now redirects to `docs.devin.ai` — it sits under
Cognition, which is probably who to ask.)

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

This asymmetry is confirmed, not assumed (2026-07-27): the Cursor and VS Code
links carry the whole config — base64 for Cursor, URL-encoded for VS Code — so
the client learns what to install from the URL itself. The Windsurf link carries
a `serverName` and nothing else, so the client must already know the server.

Getting listed therefore buys a real feature, not just a backlink. Once it lands,
add the button to `OneClickInstall.tsx` and drop Windsurf from the explanatory
note under the buttons.

One caveat for when that button ships: Windsurf deeplinks only open if the user's
team has MCP access enabled. Where an admin has disabled it nothing happens, and
the button must not be written in a way that makes that look like a fault on our
side.

Claude Code will never get a button: it is a CLI, and `claude mcp add …` is a
terminal command with no URL handler behind it. That is a permanent limitation,
not a gap to close.

## Submission content (reuse across all of them)

- **Name:** Assurly
- **Package:** `@assurly/mcp-server`
- **Install:** `npx -y @assurly/mcp-server`
- **Category:** Security / Code quality / Testing
- **One-liner:** see the pitch above
- **Transport:** stdio
- **Auth:** none for the four local tools; `assurly_verdict` takes an optional
  `ASSURLY_API_KEY` environment variable
- **Tools (5):** `assurly_scan_path`, `assurly_scan_files`, `assurly_explain_rule`,
  `assurly_verdict`, `assurly_scan_agent`
- **Differentiator worth stating in the listing:** a blocked `assurly_verdict`
  returns `isError: true`, so the agent halts instead of shipping — it is a gate,
  not a suggestion. And `assurly_scan_agent` audits the agent's own MCP config and
  instruction files, which no registry-scanning tool can see.
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
- **Repo:** the monorepo is private, so `https://github.com/assurly/assurly` is a
  404 for a reviewer. Where a repository URL is optional, leave it blank rather
  than submitting a dead link; where it is required, that directory is blocked
  until a public `packages/` repository exists. Use
  `https://www.npmjs.com/package/@assurly/mcp-server` as the canonical source link.

## After listing

- [ ] Verify each listing renders the README and the install command correctly.
- [ ] Add the directory badges/links to `assurly.dev/mcp` if they offer them
      (social proof + backlinks).
- [ ] Keep the version current — directories that read npm will reflect new
      releases automatically; manually-curated lists may need a nudge on a major
      update.
