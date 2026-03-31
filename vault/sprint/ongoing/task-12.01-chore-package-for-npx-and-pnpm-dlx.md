---
id: "12.01"
title: "Package for `npx` and `pnpm dlx` launch"
type: chore
priority: high
complexity: M
difficulty: moderate
sprint: 5
depends_on: ["10.01"]
blocks: ["12.02", "12.03"]
parent: "12"
branch: "feat/task-12-packaging-release-readiness"
assignee: dev
enriched: true
rmcp_id: "RMCP-06-A"
---

# Task 12.01: Package For `npx` And `pnpm dlx` Launch

## Business Requirements

### Problem
The canonical v1 packaging target is now explicit, but the old sprint plan did not treat packaging as its own delivery contract. The release lane needs a concrete task that makes the server runnable through the approved distribution paths.

### User Story
As an OpenCode user, I want to launch the server through `npx` or `pnpm dlx` so that setup stays lightweight and aligned with the canonical packaging target.

### Acceptance Criteria
- [ ] The packaged server can be launched through `npx` and `pnpm dlx` using the approved OpenCode-first stdio flow.
- [ ] Packaging does not require a different runtime contract than the frozen v1 schema and tool set.
- [ ] Packaging keeps self-hosted SearXNG and self-hosted reader configuration as the supported v1 provider path.
- [ ] Packaging does not imply support for alternate transports or non-v1 providers.

### Business Rules
- Approved packaging targets are `npx` and `pnpm dlx`.
- Packaging must preserve stdio-first usage for OpenCode.

### Out of Scope
- Release notes and operator guide content.
- Optional cache documentation beyond what is needed for packaging correctness.
- SearXNG bootstrap script and docker-compose.yml (covered in task 12.03).

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

## Architecture Notes

**Axis: Integration (distribution)** — Packaging enables `npx` and `pnpm dlx` execution without global install.

**Pattern: Bin-entry-with-stdio** — Package exports a bin entry that runs the MCP server over stdio.

**Rationale:** OpenCode expects MCP servers to be launchable via package managers. Stdio is the MCP transport.

**Constraints this creates:**
- `package.json` bin entry points to compiled entrypoint
- Compiled output must be self-contained (bundled or properly resolved dependencies)
- No post-install scripts that require user interaction

## Affected Areas

- `package.json` — configure:
  - `bin` entry pointing to server entrypoint
  - `files` array for published content
  - `main` and `types` for library usage (if any)
  - `engines` for Node.js version requirement
- `src/index.ts` — verify stdio MCP server entrypoint works standalone
- Build configuration (tsconfig.json, bundler if used) — ensure output is runnable
- `.npmignore` or `files` field — exclude dev files, include necessary runtime files

## Quality Gates

- `npx <package-name>` launches server and responds to MCP stdio protocol
- `pnpm dlx <package-name>` launches server and responds to MCP stdio protocol
- Server starts without errors when no config provided (uses defaults)
- Server reports provider configuration errors clearly when required env vars missing
- Published package size is reasonable (<5MB recommended)
- No source maps or dev dependencies in published package

## Gotchas

- Verify bin entry works on Windows (path separators, shell escaping)
- ESM vs CJS: ensure Node.js resolution works correctly
- If using bundler (esbuild, etc.), verify all dependencies are bundled or properly external
- Test against clean node_modules to catch missing dependency declarations
