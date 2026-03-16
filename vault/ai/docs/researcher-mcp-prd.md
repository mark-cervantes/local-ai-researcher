# Researcher MCP - PRD (v1)

This is the canonical PRD for the Researcher MCP planning direction.

Source: Derived from `docs/RESEARCHER_MCP_PRD.md` (non-canonical).

## Vision

Local-first research backend for OpenCode via an MCP stdio server that turns a prompt into high-signal web context (search results + extracted page content) with safety as a baseline (SSRF protection, bounded resource use, redacted logging).

## Approved Direction (Locked v1)

- Runtime: TypeScript on Node.js
- Interface: OpenCode-first MCP stdio server
- Providers (v1): self-hosted SearXNG (search) + self-hosted `jina-ai/reader` (read/extract)
- Content policy: full content default; truncation/excerpt must be explicit
- Dedup: request-scoped by default
- Cache: optional SQLite cache, off by default
- Packaging: `npx` / `pnpm dlx`
- Mandatory baseline: SSRF protection, resource bounds, redacted logging

## Core Use Cases (v1)

- `search`: run a query and return ranked normalized results
- `read`: extract content for a URL for AI consumption
- `gather`: search + read top results and return a single AI-ingestible bundle
- `health`: report readiness and provider connectivity

## Product Principles

- Local-first by default
- No hidden truncation
- Safety is baseline
- Bounded work (timeouts/concurrency/max bytes)
- AI-ingestible outputs (structured + provenance)

## Out of Scope (v1)

- Cloud provider dependency
- Persistent indexing/crawling/knowledge base
- Accounts/multi-tenancy
