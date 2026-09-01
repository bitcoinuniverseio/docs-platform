// Tool behaviour plus a live stdio round trip against the real server process.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolList, callTool } from '../src/tools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, '..', 'bin', 'server.mjs');

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n     ${error.message}`);
  }
}

await check('every tool declares a description and an input schema', () => {
  assert.ok(toolList.length >= 8, `expected at least 8 tools, got ${toolList.length}`);
  for (const tool of toolList) {
    assert.ok(tool.description.length > 30, `${tool.name} has a thin description`);
    assert.equal(tool.inputSchema.type, 'object');
  }
});

await check('every answer carries source provenance', () => {
  const payload = callTool('list_catalog', { kind: 'chains' });
  assert.match(payload.provenance.capabilitySource, /^bitcoinuniverseio\/core@[0-9a-f]{40}$/);
});

await check('search finds a protocol by alias rather than only by name', () => {
  const payload = callTool('search_documentation', { query: 'rune' });
  const ids = payload.results.map((r) => r.id);
  assert.ok(ids.includes('runes'), `expected runes in ${JSON.stringify(ids)}`);
});

await check('get_protocol returns the reason an action is not implemented', () => {
  const payload = callTool('get_protocol', { id: 'runes' });
  assert.equal(payload.marketplace.availability, 'read-only');
  const buy = payload.marketplace.notImplemented.find((entry) => entry.action === 'buy');
  assert.ok(buy, 'expected buy to be listed as not implemented');
  assert.ok(buy.reason.length > 20, 'expected a substantive reason');
});

await check('get_capability does not claim a read-only protocol can be bought', () => {
  const payload = callTool('get_capability', { protocol: 'runes', action: 'buy' });
  assert.equal(payload.implemented, false);
  assert.ok(payload.reasonNotImplemented, 'expected a recorded reason');
});

await check('get_capability still reports creation paths for a read-only protocol', () => {
  // Runes cannot be traded in Core but can still be etched in Inscribe. A tool
  // that conflated the two would give a wrong answer to a builder.
  const payload = callTool('get_capability', { protocol: 'runes', action: 'etch' });
  assert.equal(payload.implemented, true);
  assert.ok(payload.implementedIn.includes('Inscribe'));
});

await check('unknown ids fail with a usable list rather than an empty answer', () => {
  const payload = callTool('get_protocol', { id: 'nope' });
  assert.ok(payload.error);
  assert.ok(Array.isArray(payload.availableIds) && payload.availableIds.length > 20);
});

await check('documentation health reports gaps, not just healthy rows', () => {
  const payload = callTool('get_documentation_health', { onlyProblems: true });
  assert.ok(payload.summary.total > 0);
  for (const row of payload.repositories) {
    assert.ok(!row.ingestable || row.problems.length > 0, 'a clean row leaked into the problems view');
  }
});

await check('interfaces are returned with an exact commit in every url', () => {
  const payload = callTool('get_interfaces', { kind: 'openapi' });
  for (const entry of payload.entries) {
    assert.match(entry.url, /\/blob\/[0-9a-f]{40}\//, `not pinned: ${entry.url}`);
  }
});

// A real stdio round trip: initialize, list tools, call one.
await check('server answers initialize, tools/list, and tools/call over stdio', async () => {
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'inherit'] });
  const responses = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) responses.push(JSON.parse(line));
    }
  });

  const write = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);
  write({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  write({ jsonrpc: '2.0', method: 'notifications/initialized' });
  write({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  write({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'get_capability', arguments: { protocol: 'runes', action: 'buy' } },
  });

  await new Promise((resolve) => {
    const deadline = Date.now() + 15000;
    const poll = setInterval(() => {
      if (responses.length >= 3 || Date.now() > deadline) {
        clearInterval(poll);
        resolve();
      }
    }, 50);
  });
  child.stdin.end();
  child.kill();

  assert.equal(responses.length, 3, `expected 3 responses, got ${responses.length}`);
  assert.equal(responses[0].result.serverInfo.name, 'universe-docs');
  assert.ok(responses[1].result.tools.length >= 8);
  const text = responses[2].result.content[0].text;
  assert.match(text, /"implemented": false/);
  // The notification must not have produced a response of its own.
  assert.deepEqual(
    responses.map((r) => r.id),
    [1, 2, 3],
  );
});

if (failures > 0) {
  console.error(`\n${failures} docs-mcp check(s) failed.`);
  process.exit(1);
}
console.log('\ndocs-mcp: all assertions passed');
