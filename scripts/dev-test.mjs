#!/usr/bin/env node
/**
 * dev-test.mjs — interactive dev harness for local-ai-researcher
 *
 * Directly imports the compiled provider/tool layer, bypasses MCP protocol
 * overhead, and lets you call any tool with real config + real network.
 *
 * Usage:
 *   node scripts/dev-test.mjs read    https://example.com
 *   node scripts/dev-test.mjs read    https://example.com --mode excerpt
 *   node scripts/dev-test.mjs search  "node.js streams"
 *   node scripts/dev-test.mjs search  "node.js streams" --limit 3
 *   node scripts/dev-test.mjs gather  "node.js streams"
 *   node scripts/dev-test.mjs health
 *
 * Flags:
 *   --mode   full|excerpt   (read only, default: full)
 *   --limit  N              (search/gather only, default: 5)
 *   --json                  print raw JSON envelope instead of pretty output
 *   --help                  show this message
 *
 * Config via env vars (same as the server):
 *   JINA_READER_ENDPOINT    default: https://r.jina.ai/
 *   JINA_READER_API_KEY     optional
 *   SEARXNG_ENDPOINT        default: http://localhost:8080
 *   SEARXNG_ALLOW_PRIVATE_NETWORKS  default: false (set true for local SearXNG)
 *   LOG_LEVEL               default: warn (keep output clean)
 */

import { loadConfig }        from '../dist/config.js';
import { Logger }            from '../dist/lib/logger.js';
import { HttpClient }        from '../dist/lib/http.js';
import { SearxngProvider }   from '../dist/providers/searxng.js';
import { JinaReaderProvider} from '../dist/providers/jinaReader.js';
import { createReadTool }    from '../dist/tools/read.js';
import { createSearchTool }  from '../dist/tools/search.js';
import { createGatherTool }  from '../dist/tools/gather.js';
import { createHealthTool }  from '../dist/tools/health.js';

// ─── CLI parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help')) {
  console.log(`
dev-test.mjs — local-ai-researcher dev harness
────────────────────────────────────────────────
Usage:
  node scripts/dev-test.mjs <tool> [arg] [flags]

Tools:
  health                         check provider connectivity
  read    <url>                  fetch and extract content from a URL
  search  "<query>"              search via SearXNG
  gather  "<query>"              search + read in one shot

Flags:
  --mode   full|excerpt          read: content mode (default: full)
  --limit  N                     search/gather: max results (default: 5)
  --json                         print raw JSON envelope (default: pretty)
  --help                         this message

Examples:
  node scripts/dev-test.mjs health
  node scripts/dev-test.mjs read https://example.com
  node scripts/dev-test.mjs read https://example.com --mode excerpt
  node scripts/dev-test.mjs search "jina reader api"
  node scripts/dev-test.mjs search "jina reader api" --limit 3
  node scripts/dev-test.mjs gather "how does jina reader work"

Env (with defaults):
  JINA_READER_ENDPOINT=https://r.jina.ai/
  JINA_READER_API_KEY=
  SEARXNG_ENDPOINT=http://localhost:8080
  SEARXNG_ALLOW_PRIVATE_NETWORKS=false
  LOG_LEVEL=warn
`);
  process.exit(0);
}

const tool    = args[0];
const toolArg = args[1] && !args[1].startsWith('--') ? args[1] : undefined;
const rawJson = args.includes('--json');

function flag(name, def) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return def;
  return args[idx + 1];
}

const mode  = flag('mode',  'full');
const limit = parseInt(flag('limit', '5'), 10);

// ─── Bootstrap (quiet log level unless overridden) ────────────────────────────

// Suppress noisy info logs during dev testing unless explicitly requested
if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = 'warn';
// Allow local SearXNG by default for dev convenience
if (!process.env.SEARXNG_ALLOW_PRIVATE_NETWORKS) process.env.SEARXNG_ALLOW_PRIVATE_NETWORKS = 'true';
// Allow the SSRF guard to pass private-network addresses for local services
if (!process.env.SSRF_ALLOWED_NETWORKS) {
  process.env.SSRF_ALLOWED_NETWORKS = '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.1/32';
}

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`\n✗ Config error: ${err.message}\n`);
  process.exit(1);
}

const logger  = new Logger(config.logging);
const http    = new HttpClient(config.http);
const searxng = new SearxngProvider(config.providers.searxng, http, logger);
const jina    = new JinaReaderProvider(config.providers.jinaReader, http, logger);

const tools = {
  read:   createReadTool(jina, logger),
  search: createSearchTool(searxng, logger),
  gather: createGatherTool(searxng, jina, logger),
  health: createHealthTool(searxng, jina, logger),
};

// ─── Pretty printers ──────────────────────────────────────────────────────────

function hr(char = '─', width = 60) {
  return char.repeat(width);
}

function printEnvelope(envelope, cmd) {
  if (rawJson) {
    console.log(JSON.stringify(envelope, null, 2));
    return;
  }

  const ok    = envelope.ok ? '✓' : '✗';
  const ts    = envelope.meta?.timestamp ?? '';
  const reqId = envelope.meta?.request_id?.slice(0, 8) ?? '';

  console.log(`\n${hr()}`);
  console.log(`  ${ok}  ${cmd}   [${reqId}]  ${ts}`);
  console.log(hr());

  if (!envelope.ok) {
    console.log(`  Error: ${envelope.error?.code}`);
    console.log(`  Msg:   ${envelope.error?.message}`);
    if (envelope.error?.details) {
      console.log(`  Details:`, envelope.error.details);
    }
    console.log(hr());
    return;
  }

  const r = envelope.result;

  switch (cmd) {
    case 'health': {
      console.log(`  Status:  ${r.status}`);
      console.log(`  Memory:  ${r.resources?.memoryMB} MB`);
      console.log(`  MCP:     stdio ready=${r.mcp?.stdio?.ready}`);
      if (r.mcp?.servers?.length) {
        for (const s of r.mcp.servers) {
          const icon = s.status === 'connected' ? '✓' : '✗';
          console.log(`  ${icon}  ${s.name}: ${s.status}${s.error ? ` — ${s.error}` : ''}`);
        }
      }
      break;
    }

    case 'read': {
      const mode  = r.content_mode;
      const trunc = r.content_truncated ? ` [TRUNCATED: ${r.truncation?.reason}]` : '';
      console.log(`  URL:      ${r.url}`);
      console.log(`  Title:    ${r.title ?? '(none)'}`);
      console.log(`  Mode:     ${mode}${trunc}`);
      console.log(`  Words:    ${r.wordCount ?? '?'}`);
      console.log(`  Duration: ${r.duration ?? '?'} ms`);
      console.log(hr('─', 60));
      const body = r.content ?? r.excerpt ?? '';
      const preview = body.length > 800 ? body.slice(0, 800) + '\n  …(truncated for display)' : body;
      console.log(preview.split('\n').map(l => `  ${l}`).join('\n'));
      break;
    }

    case 'search': {
      const results = r.results ?? [];
      console.log(`  Query:    ${r.query ?? toolArg}`);
      console.log(`  Results:  ${results.length}`);
      console.log(hr('─', 60));
      for (let i = 0; i < results.length; i++) {
        const res = results[i];
        console.log(`  [${i + 1}] ${res.title}`);
        console.log(`       ${res.url}`);
        if (res.excerpt) {
          const snip = res.excerpt.slice(0, 120).replace(/\n/g, ' ');
          console.log(`       ${snip}…`);
        }
        console.log();
      }
      break;
    }

    case 'gather': {
      const reads = r.context?.reads ?? [];
      const srcs  = r.context?.results ?? [];
      console.log(`  Query:          ${r.prompt}`);
      console.log(`  Search results: ${srcs.length}`);
      console.log(`  Reads:          ${r.summary?.successfulReads}/${r.summary?.attemptedReads} succeeded`);
      console.log(`  Dedup removed:  ${r.context?.dedupStats?.deduped ?? 0}`);
      console.log(`  Duration:       ${r.summary?.totalDuration} ms`);
      console.log(hr('─', 60));
      for (const read of reads) {
        const trunc = read.content_truncated ? ' [TRUNCATED]' : '';
        console.log(`  ▸ ${read.url}${trunc}`);
        const body = read.content ?? read.excerpt ?? '';
        const snip = body.slice(0, 300).replace(/\n/g, ' ');
        if (snip) console.log(`    ${snip}…`);
        console.log();
      }
      break;
    }

    default:
      console.log(JSON.stringify(r, null, 2));
  }

  console.log(hr());
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

async function run() {
  if (!tools[tool]) {
    console.error(`\n✗ Unknown tool: "${tool}"\n  Available: health, read, search, gather\n`);
    process.exit(1);
  }

  let params;
  switch (tool) {
    case 'health':
      params = {};
      break;
    case 'read':
      if (!toolArg) { console.error('✗  read requires a URL'); process.exit(1); }
      params = { url: toolArg, content_mode: mode };
      break;
    case 'search':
      if (!toolArg) { console.error('✗  search requires a query'); process.exit(1); }
      params = { query: toolArg, limit };
      break;
    case 'gather':
      if (!toolArg) { console.error('✗  gather requires a query'); process.exit(1); }
      params = { query: toolArg, maxResults: limit };
      break;
  }

  console.log(`\n⟳  Calling ${tool}(${JSON.stringify(params)})`);
  console.log(`   Reader:  ${config.providers.jinaReader.endpoint}`);
  console.log(`   SearXNG: ${config.providers.searxng.endpoint}`);

  const start    = Date.now();
  const response = await tools[tool].handler(params);
  const elapsed  = Date.now() - start;

  const envelope = JSON.parse(response.content[0]?.text ?? '{}');
  printEnvelope(envelope, tool);
  console.log(`  ⏱  ${elapsed} ms total\n`);

  if (response.isError) process.exit(1);
}

run().catch(err => {
  console.error(`\n✗ Unhandled error: ${err.message}`);
  if (process.env.LOG_LEVEL === 'debug') console.error(err);
  process.exit(1);
});
