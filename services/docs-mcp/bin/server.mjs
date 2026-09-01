#!/usr/bin/env node
// Read-only Model Context Protocol server over the public Bitcoin Universe
// documentation estate.
//
// Speaks MCP over stdio using newline-delimited JSON-RPC 2.0. It has no
// dependencies so it runs from a bare checkout, and it is strictly read-only:
// there is no write path, no network call, and no access to any private
// repository. Every answer carries the exact source commit its capability data
// came from.
//
//   node services/docs-mcp/bin/server.mjs

import { createInterface } from 'node:readline';
import { toolList, callTool } from '../src/tools.mjs';

const PROTOCOL_VERSION = '2024-11-05';

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, payload) {
  send({ jsonrpc: '2.0', id, result: payload });
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function handle(request) {
  const { id, method, params } = request;

  // Notifications carry no id and must never be answered.
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'universe-docs', version: '0.1.0' },
        instructions:
          'Read-only access to the Bitcoin Universe public documentation estate. Capability answers state what product code implements, which is not the same as what is enabled in production. Each project documentation site remains the authority for its own subject; prefer linking a reader there rather than paraphrasing.',
      });

    case 'notifications/initialized':
      return undefined;

    case 'tools/list':
      return result(id, { tools: toolList });

    case 'tools/call': {
      const name = params?.name;
      try {
        const payload = callTool(name, params?.arguments);
        return result(id, {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        });
      } catch (error) {
        // A tool failure is reported as tool content, not a protocol error, so
        // the caller can see what went wrong rather than losing the turn.
        return result(id, {
          content: [{ type: 'text', text: `Tool error: ${error.message}` }],
          isError: true,
        });
      }
    }

    case 'ping':
      return result(id, {});

    default:
      if (isNotification) return undefined;
      return failure(id, -32601, `Method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    return failure(null, -32700, 'Parse error');
  }
  try {
    handle(request);
  } catch (error) {
    failure(request?.id ?? null, -32603, `Internal error: ${error.message}`);
  }
});

rl.on('close', () => process.exit(0));
