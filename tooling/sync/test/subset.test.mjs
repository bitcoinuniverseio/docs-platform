import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPins } from '../subset.mjs';
const repository = 'bitcoinuniverseio/example';
const entry = { commit: 'a'.repeat(40), manifestSha256: 'b'.repeat(64), sourceRef: 'main', docsRoot: 'docs', manifestId: 'example' };
const lock = { schemaVersion: 1, sources: { [repository]: entry } };
const registry = { sources: [{ repository, sourceRef: 'main' }] };
test('explicit empty pins never select every source; default still selects all', () => {
  assert.deepEqual(selectPins(lock, registry, []), []);
  assert.deepEqual(selectPins(lock, registry), [[repository, entry]]);
});
test('selected pin must exist, be registered, and have valid digest, commit and ref', () => {
  assert.throws(() => selectPins(lock, registry, ['bitcoinuniverseio/missing']), /missing/);
  assert.throws(() => selectPins(lock, { sources: [] }, [repository]), /missing/);
  for (const patch of [{ commit: 'main' }, { manifestSha256: '' }, { sourceRef: 'develop' }, { docsRoot: null }, { manifestId: '' }]) {
    assert.throws(() => selectPins({ ...lock, sources: { [repository]: { ...entry, ...patch } } }, registry, [repository]), /malformed/);
  }
});
test('even empty subsets reject malformed registry/lock structure', () => {
  assert.throws(() => selectPins({ schemaVersion: 2 }, registry, []));
  assert.throws(() => selectPins(lock, { sources: registry.sources.concat(registry.sources) }, []), /duplicate/);
  assert.throws(() => selectPins(lock, registry, ''), /array/);
});
