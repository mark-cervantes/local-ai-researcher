#!/usr/bin/env node
/**
 * mcp-call.mjs — send a single MCP JSON-RPC call to the running server via stdio.
 *
 * This talks the real MCP protocol (initialize → call → exit), so it exercises
 * the full server stack including transport and request routing.
 *
 * Usage:
 *   node scripts/mcp-call.mjs tools/list
 *   node scripts/mcp-call.mjs tools/call health
 *   node scripts/mcp-call.mjs tools/call read   '{"url":"https://example.com"}'
 *   node scripts/mcp-call.mjs tools/call search '{"query":"jina reader","limit":3}'
 *   node scripts/mcp-call.mjs tools/call gather '{"query":"what is jina ai","maxResults":2}'
 *
 * The server binary is compiled from src/index.ts → dist/index.js.
 * Run `pnpm build` first if dist/ is stale.
 *
 * Config comes from the same env vars as the server (see .env.example).
 */

import { spawn }  from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir  = dirname(fileURLToPath(import.meta.url));
const root   = resolve(__dir, '..');
const server = resolve(root, 'dist', 'index.js');

const args   = process.argv.slice(2);
const method = args[0];

if (!method || args.includes('--help')) {
  console.log(`
mcp-call.mjs — send a single MCP JSON-RPC call to local-researcher

Usage:
  node scripts/mcp-call.mjs tools/list
  node scripts/mcp-call.mjs tools/call <toolName> [paramsJSON]

Examples:
  node scripts/mcp-call.mjs tools/list
  node scripts/mcp-call.mjs tools/call health
  node scripts/mcp-call.mjs tools/call read   '{"url":"https://example.com"}'
  node scripts/mcp-call.mjs tools/call search '{"query":"jina reader api","limit":3}'
  node scripts/mcp-call.mjs tools/call gather '{"query":"what is jina ai","maxResults":2}'

The server reads env vars for config (JINA_READER_ENDPOINT, SEARXNG_ENDPOINT, etc).
`);
  process.exit(0);
}

// ─── helpers ──────────────────────────────────────────────────────────────────

let idSeq = 1;
function nextId() { return idSeq++; }

function rpc(method, params) {
  return JSON.stringify({ jsonrpc: '2.0', id: nextId(), method, params }) + '\n';
}

// ─── spawn server ─────────────────────────────────────────────────────────────

const env = {
  ...process.env,
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
  SEARXNG_ALLOW_PRIVATE_NETWORKS: process.env.SEARXNG_ALLOW_PRIVATE_NETWORKS ?? 'true',
  SSRF_ALLOWED_NETWORKS: process.env.SSRF_ALLOWED_NETWORKS
    ?? '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.1/32',
};

const proc = spawn('node', [server], {
  env,
  stdio: ['pipe', 'pipe', 'inherit'],  // stderr → terminal (server logs)
});

proc.on('error', err => {
  console.error(`✗ Failed to start server: ${err.message}`);
  console.error(`  (run "pnpm build" first if dist/ is stale)`);
  process.exit(1);
});

// ─── JSON-RPC exchange ────────────────────────────────────────────────────────

const rl = createInterface({ input: proc.stdout });

let phase   = 'init';        // 'init' | 'call' | 'done'
let pending = new Map();     // id → { resolve, reject }
let buffer  = '';

proc.stdout.on('data', chunk => { buffer += chunk.toString(); });

rl.on('line', raw => {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  if (msg.id && pending.has(msg.id)) {
    const { resolve } = pending.get(msg.id);
    pending.delete(msg.id);
    resolve(msg);
  }
});

function send(obj) {
  return new Promise((resolve, reject) => {
    const str = JSON.stringify(obj) + '\n';
    pending.set(obj.id, { resolve, reject });
    proc.stdin.write(str);
  });
}

// ─── protocol flow ────────────────────────────────────────────────────────────

async function main() {
  // 1. initialize
  const initResp = await send({
    jsonrpc: '2.0',
    id: nextId(),
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'dev-mcp-call', version: '0.0.1' },
    },
  });

  if (initResp.error) {
    console.error('✗ initialize failed:', JSON.stringify(initResp.error, null, 2));
    proc.kill();
    process.exit(1);
  }

  // 2. initialized notification (required by spec)
  proc.stdin.write(
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n'
  );

  // 3. perform the requested call
  let resp;

  if (method === 'tools/list') {
    resp = await send({
      jsonrpc: '2.0',
      id: nextId(),
      method: 'tools/list',
      params: {},
    });
  } else if (method === 'tools/call') {
    const toolName   = args[1];
    const rawParams  = args[2] ?? '{}';
    let toolParams;
    try {
      toolParams = JSON.parse(rawParams);
    } catch {
      console.error(`✗ Could not parse params JSON: ${rawParams}`);
      proc.kill();
      process.exit(1);
    }

    resp = await send({
      jsonrpc: '2.0',
      id: nextId(),
      method: 'tools/call',
      params: { name: toolName, arguments: toolParams },
    });
  } else {
    console.error(`✗ Unknown method: ${method}`);
    console.error('  Supported: tools/list, tools/call');
    proc.kill();
    process.exit(1);
  }

  // 4. print result
  if (resp.error) {
    console.error('\n✗ RPC error:');
    console.error(JSON.stringify(resp.error, null, 2));
    proc.kill();
    process.exit(1);
  }

  if (method === 'tools/list') {
    const tools = resp.result?.tools ?? [];
    console.log(`\n${tools.length} tool(s) registered:\n`);
    for (const t of tools) {
      console.log(`  • ${t.name}`);
      console.log(`    ${t.description}`);
      const props = Object.keys(t.inputSchema?.shape ?? t.inputSchema?.properties ?? {});
      if (props.length) console.log(`    params: ${props.join(', ')}`);
      console.log();
    }
  } else {
    // tools/call — the result content is a JSON string
    const content = resp.result?.content?.[0]?.text;
    if (!content) {
      console.log(JSON.stringify(resp.result, null, 2));
    } else {
      try {
        const envelope = JSON.parse(content);
        console.log('\n' + JSON.stringify(envelope, null, 2));
      } catch {
        console.log(content);
      }
    }
  }

  // 5. clean shutdown
  proc.stdin.end();
  proc.kill('SIGTERM');
  setTimeout(() => process.exit(0), 200);
}

main().catch(err => {
  console.error(`\n✗ ${err.message}`);
  proc.kill();
  process.exit(1);
});
