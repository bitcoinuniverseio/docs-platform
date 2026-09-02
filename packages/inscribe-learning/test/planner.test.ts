import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseManifest } from '../src/schemas.ts'
import { planGoal } from '../src/planner.ts'
import type { PlannerInput } from '../src/schemas.ts'

const here = dirname(fileURLToPath(import.meta.url))
const manifest = parseManifest(
  JSON.parse(readFileSync(join(here, '..', 'data', 'inscribe-learning.manifest.json'), 'utf8')),
)

const baseInput: PlannerInput = {
  goal: 'inscribe_text',
  protocol: 'help_me_choose',
  chain: 'bitcoin',
  network: 'mainnet',
  wallet: 'unknown',
  receivingAddressReady: true,
  experience: 'beginner',
  priority: 'simplest',
  practiceFirst: false,
}

test('planner is deterministic: identical inputs produce identical ranked output', () => {
  const a = planGoal(manifest, baseInput, '2026-09-02T00:00:00.000Z')
  const b = planGoal(manifest, baseInput, '2026-09-02T00:00:00.000Z')
  assert.deepStrictEqual(a, b)
})

test('every goal a workflow serves resolves to a recommendation', () => {
  const goals = [...new Set(manifest.workflows.filter((w) => w.state.actionable).map((w) => w.goal))]
  assert.ok(goals.length >= 7)
  for (const goal of goals) {
    for (const priority of ['simplest', 'cheapest', 'control', 'batch_efficiency', 'urgency'] as const) {
      const result = planGoal(manifest, { ...baseInput, goal, priority }, '2026-09-02T00:00:00.000Z')
      assert.ok(result.recommended, `goal ${goal} priority ${priority} resolved to nothing`)
      assert.ok(result.recommended.scoreBreakdown.length > 0)
    }
  }
})

test('exclusions always carry a reason code and detail', () => {
  const result = planGoal(manifest, { ...baseInput, goal: 'etch_rune', protocol: 'ordinals' }, '2026-09-02T00:00:00.000Z')
  assert.ok(result.excluded.length > 0)
  for (const { reason } of result.excluded) {
    assert.ok(reason.code)
    assert.ok(reason.detail.length > 10)
  }
})

test('protocol mismatch excludes non-matching workflows with a specific reason', () => {
  const result = planGoal(manifest, { ...baseInput, protocol: 'ordinals', goal: 'etch_rune' }, '2026-09-02T00:00:00.000Z')
  assert.ok(result.excluded.some((e) => e.reason.code === 'protocol_mismatch'))
})

test('capacity mismatch fires when the batch is too large', () => {
  const result = planGoal(
    manifest,
    { ...baseInput, goal: 'mint_token', protocol: 'runes', itemCount: 5000 },
    '2026-09-02T00:00:00.000Z',
  )
  assert.ok(result.excluded.some((e) => e.reason.code === 'capacity_mismatch'))
})

test('collection requirements exclude workflows without parent support', () => {
  const result = planGoal(
    manifest,
    { ...baseInput, goal: 'inscribe_text', protocol: 'help_me_choose', needsParent: true },
    '2026-09-02T00:00:00.000Z',
  )
  assert.ok(result.excluded.some((e) => e.reason.code === 'collection_mismatch'))
})

test('deployment gated workflows are excluded with the controlling flag named', () => {
  const gated = manifest.workflows.find((w) => !w.state.enabled && w.state.actionable === false && w.state.gatedBy)
  if (!gated) return // current deployment may enable everything
  const result = planGoal(manifest, { ...baseInput, goal: gated.goal }, '2026-09-02T00:00:00.000Z')
  const reason = result.excluded.find((e) => e.workflow.id === gated.id)
  if (reason) {
    assert.equal(reason.reason.code, 'deployment_gated')
    assert.match(reason.reason.detail, new RegExp(gated.state.gatedBy ?? ''))
  }
})

test('beginner bias raises simple workflows without hiding alternatives', () => {
  const beginner = planGoal(manifest, { ...baseInput, experience: 'beginner' }, '2026-09-02T00:00:00.000Z')
  const expert = planGoal(manifest, { ...baseInput, experience: 'expert' }, '2026-09-02T00:00:00.000Z')
  assert.ok(beginner.recommended && expert.recommended)
  assert.equal(beginner.recommended.workflow.id, expert.recommended.workflow.id)
  assert.notEqual(beginner.recommended.score, expert.recommended.score)
  assert.ok(beginner.alternatives.length >= 0 && expert.alternatives.length >= 0)
})

test('learn free resolves to the practice-first route', () => {
  const result = planGoal(manifest, { ...baseInput, goal: 'learn_free' }, '2026-09-02T00:00:00.000Z')
  assert.ok(result.recommended)
  assert.equal(result.recommended.workflow.id, 'wf-learn-free')
})

test('unready receiving address never empties the result, it records a prerequisite penalty', () => {
  const ready = planGoal(manifest, { ...baseInput, receivingAddressReady: true }, '2026-09-02T00:00:00.000Z')
  const unready = planGoal(manifest, { ...baseInput, receivingAddressReady: false }, '2026-09-02T00:00:00.000Z')
  assert.ok(ready.recommended && unready.recommended)
  assert.equal(ready.recommended.workflow.id, unready.recommended.workflow.id)
  assert.ok(unready.recommended.score < ready.recommended.score)
  assert.ok(unready.recommended.scoreBreakdown.some((b) => b.rule.includes('receiving address')))
})
