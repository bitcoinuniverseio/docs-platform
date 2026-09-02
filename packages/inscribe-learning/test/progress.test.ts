import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseManifest } from '../src/schemas.ts'
import { migrateV1, mergeProgress, exportPassport, importPassport, parseProgressV2 } from '../src/progress.ts'

const here = dirname(fileURLToPath(import.meta.url))
const manifest = parseManifest(
  JSON.parse(readFileSync(join(here, '..', 'data', 'inscribe-learning.manifest.json'), 'utf8')),
)

const v1 = {
  guides: {
    'first-inscription': { steps: [0, 1, 2], done: false, at: 1756000000000 },
    'inscribe-text': { steps: [0], done: true, at: 1756000100000 },
    'guide-that-no-longer-exists': { steps: [0, 1], done: false, at: 1756000200000 },
  },
}

test('v1 index progress migrates onto stable step ids without loss', () => {
  const { progress, dropped } = migrateV1(v1, manifest)
  assert.equal(progress.version, 2)
  const first = progress.guides['first-inscription']
  assert.ok(first)
  assert.deepEqual(first.steps, [
    'first-inscription_connect-your-wallet',
    'first-inscription_open-inscribe-text',
    'first-inscription_set-the-receiver-and-fee',
  ])
  assert.equal(progress.guides['inscribe-text'].done, true)
  assert.equal(dropped.length, 2)
  assert.deepEqual(dropped, [
    { guideId: 'guide-that-no-longer-exists', index: 0 },
    { guideId: 'guide-that-no-longer-exists', index: 1 },
  ])
})

test('malformed progress is rejected, not silently accepted', () => {
  assert.throws(() => migrateV1({ guides: { x: { steps: ['zero'], done: false, at: 1 } } }, manifest))
  assert.throws(() => migrateV1({ guides: { g: { steps: 'nope', done: false, at: 1 } } }, manifest))
  assert.throws(() => parseProgressV2({ version: 3, guides: {} }))
})

test('merge unions steps and keeps the later timestamp', () => {
  const a = parseProgressV2({ version: 2, guides: { g1: { steps: ['g1_a'], done: false, at: 100 } } })
  const b = parseProgressV2({ version: 2, guides: { g1: { steps: ['g1_b'], done: true, at: 200 }, g2: { steps: [], done: false, at: 50 } } })
  const merged = mergeProgress(a, b)
  assert.deepEqual(merged.guides.g1.steps.sort(), ['g1_a', 'g1_b'])
  assert.equal(merged.guides.g1.done, true)
  assert.equal(merged.guides.g1.at, 200)
  assert.ok(merged.guides.g2)
})

test('passport round-trips and carries only guide, step, and timestamp data', () => {
  const progress = parseProgressV2({
    version: 2,
    guides: { 'first-inscription': { steps: ['first-inscription_open-inscribe-text'], done: false, at: 1756000000000 } },
  })
  const text = exportPassport(progress, '2026-09-02T00:00:00.000Z')
  assert.match(text, /^UBP2-[0-9a-f]{8}-/)
  const imported = importPassport(text)
  assert.equal(imported.version, 2)
  assert.equal(imported.exportedAt, '2026-09-02T00:00:00.000Z')
  assert.deepEqual(imported.progress, progress)
  const serialized = JSON.stringify(imported)
  for (const forbidden of ['address', 'bc1', 'txid', 'orderid', 'seed']) {
    assert.ok(!serialized.toLowerCase().includes(forbidden), forbidden)
  }
})

test('tampered passports are rejected', () => {
  const text = exportPassport(parseProgressV2({ version: 2, guides: {} }), '2026-09-02T00:00:00.000Z')
  const tampered = text.slice(0, -2) + (text.endsWith('aa') ? 'bb' : 'aa')
  assert.throws(() => importPassport(tampered), /checksum/)
  assert.throws(() => importPassport('not a passport'), /not a Universe/)
  assert.throws(() => importPassport('UBP2-deadbeef-WyJhIl0='), /valid JSON|checksum/)
})
