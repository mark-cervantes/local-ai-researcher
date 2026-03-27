---
id: thread-researcher-mcp-sdlc-planning
title: "Researcher MCP SDLC planning"
status: in-progress
priority: high
created: 2026-03-18
updated: 2026-03-18
owner: orchestrator
links:
  - vault/ai/docs/researcher-mcp-prd.md
  - vault/ai/docs/researcher-mcp-srs.md
  - vault/ai/docs/researcher-mcp-plan.md
  - vault/ai/docs/researcher-mcp-task-skeletons.md
next_action: "Run the SDLC orchestrator through the planning pipeline using the vault-canonical Researcher MCP docs and produce executable vault/sprint artifacts."
---

## Intent

Route the Researcher MCP planning work through the proper SDLC pipeline so the canonical vault docs become executable sprint artifacts without skipping lifecycle checks.

## Current State

- Canonical planning memory now exists in `vault/ai/docs/`.
- Existing `vault/sprint/` contents belong to an older planning/execution stream and should not be overwritten blindly.
- The next safe step is to run the SDLC workflow against the vault-canonical Researcher MCP plan and let it determine what planning artifacts should be added or updated.

## Next Action

Run the SDLC orchestrator through the planning pipeline using the vault-canonical Researcher MCP docs and produce executable vault/sprint artifacts.

## Notes / Parking Lot

- After SDLC planning completes, deprecate `docs/RESEARCHER_MCP_*.md` with short banners pointing to `vault/ai/docs/`.
