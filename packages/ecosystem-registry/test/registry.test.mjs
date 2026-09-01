// Registry consistency. These run in CI so a bad join fails the build instead of
// publishing an Atlas page with empty cells.
import assert from 'node:assert/strict';
import {
  protocols,
  products,
  chains,
  provenance,
  validateRegistry,
  protocolsForProduct,
  getProtocol,
} from '../src/index.js';

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n     ${error.message}`);
  }
}

check('registry validates with no problems', () => {
  const problems = validateRegistry();
  assert.deepEqual(problems, [], `problems:\n  ${problems.join('\n  ')}`);
});

check('provenance records an exact Core commit', () => {
  assert.match(provenance.sourceCommit, /^[0-9a-f]{40}$/);
  assert.equal(provenance.repository, 'bitcoinuniverseio/core');
});

check('every chain has at least one protocol', () => {
  for (const chain of chains) {
    const found = protocols.filter((p) => p.chain === chain.id);
    assert.ok(found.length > 0, `chain ${chain.id} has no protocols`);
  }
});

check('capability-backed protocols carry marketplace availability', () => {
  const withMarket = protocols.filter((p) => p.marketplace);
  assert.ok(withMarket.length >= 25, `expected the marketplace registry to be joined, got ${withMarket.length}`);
  for (const p of withMarket) {
    assert.ok(p.marketplace.availability, `${p.id} has no availability`);
    assert.ok(Array.isArray(p.marketplace.actions.supported), `${p.id} has no supported action list`);
  }
});

check('unsupported actions always carry a reason', () => {
  for (const p of protocols) {
    for (const entry of p.marketplace?.actions?.unsupported ?? []) {
      assert.ok(
        entry.reason && entry.reason.length > 10,
        `${p.id}.${entry.action} is unsupported with no usable reason`,
      );
    }
  }
});

check('product protocol lists are derived and non-empty for Core', () => {
  const core = protocolsForProduct('core');
  assert.ok(core.length > 10, `expected Core to expose many protocols, got ${core.length}`);
  for (const { protocol, actions } of core) {
    assert.ok(actions.length > 0, `${protocol.id} listed for Core with no actions`);
  }
});

check('every product points at a documentation repository', () => {
  for (const product of products) {
    assert.match(product.documentationRepository, /^bitcoinuniverseio\//);
  }
});

check('read-only protocols never claim a trade action', () => {
  const tradeActions = new Set(['list', 'buy', 'unlist', 'update-listing', 'make-offer', 'accept-offer', 'sell']);
  for (const p of protocols) {
    if (p.marketplace?.availability !== 'read-only') continue;
    for (const { action } of p.marketplace.actions.supported) {
      assert.ok(!tradeActions.has(action), `${p.id} is read-only but claims ${action}`);
    }
  }
});

check('Runes is recorded as read only, matching the first-party read path', () => {
  const runes = getProtocol('runes');
  assert.equal(runes.marketplace.availability, 'read-only');
});

// The registry declares a broad action list per surface while the marketplace
// policy is the authority on what is implemented. If the two are published
// unreconciled, a page claims a capability it then denies further down.
check('no surface advertises an action its marketplace policy marks unsupported', () => {
  for (const p of protocols) {
    const policy = p.marketplace;
    if (!policy?.owner || !policy.actions) continue;
    const unsupported = new Set(policy.actions.unsupported.map((entry) => entry.action));
    const ownerLabel = { main: 'Core', wallet: 'Wallet', inscribe: 'Inscribe', stampdex: 'StampDEX' }[
      policy.owner
    ];
    const surface = p.surfaces.find((candidate) => candidate.label === ownerLabel);
    if (!surface) continue;
    for (const action of surface.actions) {
      assert.ok(
        !unsupported.has(action),
        `${p.id} advertises ${action} on ${ownerLabel} but its policy marks it unsupported`,
      );
    }
  }
});

check('read-only protocols expose no trade action on their marketplace surface', () => {
  const trade = new Set(['list', 'buy', 'unlist', 'update-listing', 'make-offer', 'accept-offer', 'sell', 'settle']);
  for (const p of protocols) {
    if (p.marketplace?.availability !== 'read-only') continue;
    const surface = p.surfaces.find((candidate) => candidate.label === 'Core');
    for (const action of surface?.actions ?? []) {
      assert.ok(!trade.has(action), `read-only ${p.id} still shows ${action} on Core`);
    }
  }
});

// The manifest schema decides which protocol ids a repository is allowed to
// declare, and the registry decides which ids the portal keys on. They drifted:
// the schema forbade underscores while eight real ids contain one, so
// op_return, tap_doge and six others could not be declared by any repository at
// all. A repository documenting a protocol it cannot name is a silent gap.
check('every registry protocol id is declarable in a manifest', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.join(
    here,
    '..',
    '..',
    'content-schema',
    'schemas',
    'docs.manifest.schema.json',
  );
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const pattern = new RegExp(schema.properties.protocols.items.pattern);
  const rejected = protocols.map((p) => p.id).filter((id) => !pattern.test(id));
  assert.deepEqual(
    rejected,
    [],
    `the manifest schema rejects these registry ids: ${rejected.join(', ')}`,
  );
});

if (failures > 0) {
  console.error(`\n${failures} registry check(s) failed.`);
  process.exit(1);
}
console.log('\nregistry: all assertions passed');
