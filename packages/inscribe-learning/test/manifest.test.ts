import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseManifest, tryParseManifest } from '../src/schemas.ts'

const here = dirname(fileURLToPath(import.meta.url))
const manifestPath = join(here, '..', 'data', 'inscribe-learning.manifest.json')
const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))

test('generated manifest parses against the strict schema', () => {
  assert.equal(manifest.schemaVersion, 1)
  assert.ok(manifest.workflows.length >= 30)
  assert.ok(manifest.protocols.length >= 20)
  assert.ok(manifest.guides.length >= 60)
  assert.ok(manifest.recovery.outcomes.length >= 14)
  for (const commit of Object.values(manifest.sourceCommits)) {
    assert.match(commit, /^[0-9a-f]{40}$/)
  }
})

test('unknown fields are rejected at the manifest root', () => {
  const copy = JSON.parse(JSON.stringify(manifest))
  copy.notARealField = true
  const result = tryParseManifest(copy)
  assert.equal(result.ok, false)
  assert.match(result.issues, /notARealField|Invalid key/)
})

test('no workflow collapses the three availability dimensions into one boolean', () => {
  for (const workflow of manifest.workflows) {
    assert.ok('implemented' in workflow.state)
    assert.ok('enabled' in workflow.state)
    assert.ok('actionable' in workflow.state)
  }
})

test('every actionable workflow has guides, safety checks, and an explainable intent', () => {
  for (const workflow of manifest.workflows) {
    if (!workflow.state.actionable) continue
    assert.ok(workflow.guides.length > 0, `${workflow.id} has no guides`)
    assert.ok(workflow.safetyChecks.length >= 3, `${workflow.id} has too few safety checks`)
    assert.ok(workflow.stages.length >= 2, `${workflow.id} has no stages`)
    for (const guideId of workflow.guides) {
      assert.ok(manifest.guides.some((g) => g.id === guideId), `${workflow.id} references missing guide ${guideId}`)
    }
  }
})

test('read-only and gated protocols are present but never actionable', () => {
  for (const protocol of manifest.protocols) {
    if (protocol.state.implemented && protocol.state.enabled && protocol.operations.length > 0) continue
    assert.equal(
      protocol.state.actionable, false,
      `${protocol.id} must not be actionable`,
    )
  }
})

test('recovery outcomes cover every required terminal state', () => {
  const ids = new Set(manifest.recovery.outcomes.map((o) => o.id))
  for (const required of [
    'recovery-unpaid-order',
    'recovery-payment-not-detected',
    'recovery-underpayment-topup',
    'recovery-overpayment',
    'recovery-stuck-payment',
    'recovery-stuck-user-tx',
    'recovery-closed-tab',
    'recovery-expired-quote',
    'recovery-late-payment',
    'recovery-padding-recoverable',
    'recovery-failed-reveal',
    'recovery-deployment-disabled',
    'recovery-source-stale',
    'recovery-wrong-address',
  ]) {
    assert.ok(ids.has(required), `missing recovery outcome ${required}`)
  }
  for (const outcome of manifest.recovery.outcomes) {
    if (outcome.reversibility === 'irreversible') {
      assert.ok(outcome.stopConditions.length > 0, `${outcome.id} irreversible without stop conditions`)
    }
  }
})

test('wrong-address outcome is the only irreversible one and never promises recovery', () => {
  const wrong = manifest.recovery.outcomes.find((o) => o.id === 'recovery-wrong-address')
  assert.ok(wrong)
  assert.equal(wrong.reversibility, 'irreversible')
  assert.equal(manifest.recovery.outcomes.filter((o) => o.reversibility === 'irreversible').length, 1)
})
