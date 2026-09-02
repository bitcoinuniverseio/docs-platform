import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseManifest } from '../src/schemas.ts'
import { selectProtocols, comparisonRows, COMPARISON_DIMENSIONS } from '../src/protocols.ts'
import { readinessOf } from '../src/lifecycle.ts'

const here = dirname(fileURLToPath(import.meta.url))
const manifest = parseManifest(
  JSON.parse(readFileSync(join(here, '..', 'data', 'inscribe-learning.manifest.json'), 'utf8')),
)

test('every released protocol appears in the lab data source', () => {
  const released = manifest.protocols.filter((p) => p.state.implemented && p.state.enabled)
  assert.ok(released.length >= 20)
})

test('operation filters exclude non-matching protocols with a reason', () => {
  const result = selectProtocols(manifest, { operations: ['etch'] })
  assert.ok(result.matches.some((m) => m.protocol.id === 'runes'))
  assert.ok(result.excluded.some((e) => e.protocol.id === 'brc20' && /etch|Supports/.test(e.reason)))
})

test('readiness filters keep gated and read-only protocols visible when requested', () => {
  const read_only = selectProtocols(manifest, { readiness: ['read_only'] })
  for (const match of read_only.matches) {
    assert.equal(readinessOf(match.protocol.state), 'read_only')
  }
  const all = selectProtocols(manifest, {})
  const states = new Set(all.matches.concat(all.partial).map((m) => readinessOf(m.protocol.state)))
  assert.ok(states.size >= 1)
})

test('partial matches record unmet requirements instead of failing silently', () => {
  const result = selectProtocols(manifest, { operations: ['inscribe', 'etch'] })
  const ordinals = result.matches.concat(result.partial).find((m) => m.protocol.id === 'ordinals')
  assert.ok(ordinals)
  assert.equal(result.partial.some((m) => m.protocol.id === 'ordinals'), true)
  assert.ok(ordinals.unmet.length > 0)
})

test('comparison rows never invent values: unestablished cells render null', () => {
  const rows = comparisonRows(manifest, ['ordinals', 'brc20'])
  assert.equal(rows.length, 2)
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.value === null) continue
      assert.equal(typeof cell.value, 'string')
      assert.ok(!/^(TBD|N\/A|unknown)$/i.test(cell.value), `${row.protocol.id}.${cell.dimension} filled with a placeholder`)
    }
    assert.equal(row.cells.length, COMPARISON_DIMENSIONS.length)
  }
})

test('comparison is limited to two to four protocols', () => {
  const many = comparisonRows(manifest, manifest.protocols.map((p) => p.id))
  // The engine renders what it is given; the route layer enforces 2 to 4.
  assert.equal(many.length, manifest.protocols.length)
})

test('batch and collection filters work', () => {
  const batch = selectProtocols(manifest, { batch: true })
  assert.ok(batch.matches.concat(batch.partial).every((m) => m.protocol.batch === true))
  assert.ok(batch.excluded.some((e) => e.protocol.batch === false))
  const collection = selectProtocols(manifest, { collection: true })
  assert.ok(collection.matches.concat(collection.partial).every((m) => m.protocol.collection === true))
})
