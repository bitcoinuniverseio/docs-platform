import test from 'node:test'
import assert from 'node:assert/strict'
import { loadManifest, safeLoadManifest } from '../src/manifest.ts'
import { readinessOf, resolveHealth } from '../src/lifecycle.ts'
import { slugify, stepId, workflowId } from '../src/ids.ts'
import { provenanceFooter, mergeSources } from '../src/provenance.ts'

test('bundled manifest loads and validates', () => {
  const manifest = loadManifest()
  assert.equal(manifest.schemaVersion, 1)
  const safe = safeLoadManifest()
  assert.equal(safe.ok, true)
})

test('health resolution never upgrades an unreachable dependency to healthy', () => {
  assert.equal(resolveHealth({}, []), 'healthy')
  assert.equal(resolveHealth({ a: 'healthy' }, ['a']), 'healthy')
  assert.equal(resolveHealth({ a: 'stale' }, ['a']), 'stale')
  assert.equal(resolveHealth({ a: 'unavailable' }, ['a']), 'unavailable')
  assert.equal(resolveHealth({ a: 'healthy' }, ['a', 'missing']), 'unknown')
  assert.equal(resolveHealth({ a: 'disabled' }, ['a', 'healthy']), 'disabled')
  assert.equal(resolveHealth({ a: 'unavailable', b: 'stale' }, ['a', 'b']), 'unavailable')
})

test('readiness separates the three dimensions', () => {
  assert.equal(readinessOf({ implemented: true, enabled: true, healthDependencies: [], actionable: true }), 'ready')
  assert.equal(readinessOf({ implemented: true, enabled: false, healthDependencies: [], actionable: true }), 'gated')
  assert.equal(readinessOf({ implemented: false, enabled: true, healthDependencies: [], actionable: true }), 'incomplete')
  assert.equal(readinessOf({ implemented: true, enabled: true, healthDependencies: [], actionable: false }), 'read_only')
})

test('ids are stable and slug safe', () => {
  assert.equal(slugify('Set the Receiver and Fee!'), 'set-the-receiver-and-fee')
  assert.equal(stepId('guide', 0, 'My Step'), 'guide_my-step')
  assert.equal(stepId('guide', 0, 'x', 'explicit-id'), 'explicit-id')
  assert.equal(workflowId('op_return', 'inscribe', 'inscribe_text'), 'wf-op-return-inscribe-inscribe-text')
})

test('provenance footer names every source commit and the verification date', () => {
  const footer = provenanceFooter({
    sources: [
      { repository: 'inscribe', commit: 'a'.repeat(40), path: 'x', proves: 'p' },
      { repository: 'inscribe', commit: 'a'.repeat(40), path: 'y', proves: 'q' },
      { repository: 'docs-inscribe', commit: 'b'.repeat(40), path: 'z', proves: 'r' },
    ],
    lastVerified: '2026-09-02T00:00:00.000Z',
    owningRoute: '/guided/',
  })
  assert.match(footer, /inscribe@aaaaaaaaaaaa/)
  assert.match(footer, /docs-inscribe@bbbbbbbbbbbb/)
  assert.match(footer, /2026-09-02/)
  assert.match(footer, /\/guided\//)
})

test('merge sources deduplicates on repository, path, and claim', () => {
  const merged = mergeSources(
    [{ repository: 'inscribe', commit: 'a'.repeat(40), path: 'x', proves: 'p' }],
    [{ repository: 'inscribe', commit: 'a'.repeat(40), path: 'x', proves: 'p' },
     { repository: 'inscribe', commit: 'a'.repeat(40), path: 'y', proves: 'q' }],
  )
  assert.equal(merged.length, 2)
})
