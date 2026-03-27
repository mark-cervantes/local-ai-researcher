# Module Map — Researcher MCP v1

## Purpose

This module map records the current codebase structure and the intended boundaries for the approved Researcher MCP v1 direction. It exists so Plan-phase tasks can target the right modules without re-discovering architecture from scratch.

## System Entry And Composition

- `src/index.ts` — MCP stdio entrypoint; composes config, logging, HTTP client, providers, and tool registry
- `src/config.ts` — environment-driven configuration loader and validator for provider, HTTP, logging, gather, and MCP settings

## Domain Contract Layer

- `src/domain/types.ts` — shared contract and envelope types, including tool result shapes, schema versioning, and config/provider types

## Provider Boundary

- `src/providers/searxng.ts` — search provider adapter; normalizes SearXNG responses into domain `SearchResult` objects and exposes health checks
- `src/providers/jinaReader.ts` — read/extract provider adapter; normalizes reader responses into domain `ReadResult` objects and exposes health checks

Provider modules are the only place where upstream API details should be translated into the domain model. Tool outputs should remain provider-agnostic.

## Tool Layer

- `src/tools/search.ts` — MCP-facing search tool built on the SearXNG provider
- `src/tools/read.ts` — MCP-facing read tool built on the Jina Reader provider
- `src/tools/gather.ts` — orchestration tool that runs search plus reads, performs request-scoped dedup, and produces the AI-facing aggregate response
- `src/tools/health.ts` — readiness and provider-connectivity reporting tool

## Infrastructure And Safety Layer

- `src/lib/http.ts` — outbound HTTP abstraction, retry handling, timeouts, and request-bound controls
- `src/lib/ssrf.ts` — SSRF guardrails and network policy enforcement for outbound requests
- `src/lib/logger.ts` — redacted structured logging to stderr
- `src/lib/url.ts` — URL normalization/canonicalization helpers used for dedup and stable IDs
- `src/lib/errors.ts` — typed error taxonomy and error envelope helpers

## Current Test Surface

- `src/lib/errors.test.ts`
- `src/lib/url.test.ts`
- `src/tools/gather.test.ts`

The current test surface is partial. Plan-phase work should assume additional contract, provider, and integration coverage is still required for the approved v1 scope.

## Planning Implications

- Foundation and safety work should land in `src/config.ts`, `src/lib/http.ts`, `src/lib/ssrf.ts`, `src/lib/logger.ts`, and `src/domain/types.ts`.
- Provider-specific tasks should stay within `src/providers/` plus the directly affected tool wrappers.
- Schema-freeze and contract-test work should target `src/domain/types.ts`, tool handlers under `src/tools/`, and the corresponding tests.
- Packaging and release-readiness work should target `package.json`, top-level docs, and test/build configuration without widening product scope.
