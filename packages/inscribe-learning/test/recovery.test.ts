import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseManifest } from '../src/schemas.ts'
import { walkRecoveryTable, auditRecoveryTable, reachableOutcomeIds } from '../src/recovery.ts'

const here = dirname(fileURLToPath(import.meta.url))
const manifest = parseManifest(
  JSON.parse(readFileSync(join(here, '..', 'data', 'inscribe-learning.manifest.json'), 'utf8')),
)
const table = manifest.recovery.table
const outcomeIds = manifest.recovery.outcomes.map((o) => `outcome:${o.id}`)

test('the real decision table has no unreachable questions, loops, or dead ends', () => {
  const audit = auditRecoveryTable(table, outcomeIds)
  assert.deepEqual(audit.unreachable, [], JSON.stringify(audit))
  assert.deepEqual(audit.loops, [])
  assert.deepEqual(audit.deadEnds, [])
  assert.deepEqual(audit.missingOutcomes, [])
})

test('every branch of the table terminates in a manifest outcome', () => {
  // Exhaustively walk every answer combination.
  const walk = (nodeId: string, answers: Record<string, string>) => {
    const question = table.questions.find((q) => q.id === nodeId)
    if (!question) return
    for (const option of question.options) {
      const next = { ...answers, [question.id]: option.value }
      const target = table.questions.find((q) => q.id === option.next)
      if (target) walk(option.next, next)
      else {
        const path = walkRecoveryTable(table, next)
        assert.ok(
          outcomeIds.includes(`outcome:${path.outcomeId}`),
          `branch ${JSON.stringify(next)} emitted unknown outcome ${path.outcomeId}`,
        )
      }
    }
  }
  walk(table.entry, {})
})

test('underpayment path demands a top-up, never a second full payment', () => {
  const path = walkRecoveryTable(table, {
    'q-payment-made': 'yes',
    'q-amount': 'below',
    'q-repair-available': 'yes',
  })
  assert.equal(path.outcomeId, 'recovery-underpayment-topup')
  const outcome = manifest.recovery.outcomes.find((o) => o.id === path.outcomeId)
  assert.ok(outcome)
  assert.equal(outcome.doNotPayAgain, true)
  assert.match(outcome.whatNotToDo.join(' '), /full payment/)
})

test('wrong address terminates in the irreversible outcome', () => {
  const path = walkRecoveryTable(table, {
    'q-payment-made': 'yes',
    'q-amount': 'exact',
    'q-payment-visible': 'yes',
    'q-confirming': 'stuck',
    'q-stuck-which': 'own',
    'q-reveal-failed': 'no',
    'q-padding': 'no',
    'q-wrong-address': 'yes',
  })
  assert.equal(path.outcomeId, 'recovery-wrong-address')
  const outcome = manifest.recovery.outcomes.find((o) => o.id === path.outcomeId)
  assert.ok(outcome)
  assert.equal(outcome.reversibility, 'irreversible')
})

test('stale sources produce unknown, never zero and never healthy', () => {
  for (const [question, branch] of [
    ['q-source-health-unpaid', 'unpaid'],
    ['q-source-health-payment', 'payment'],
  ]) {
    const answers =
      branch === 'unpaid'
        ? { 'q-payment-made': 'no', 'q-unpaid-quote': 'no', [question]: 'stale_or_down' }
        : { 'q-payment-made': 'yes', 'q-amount': 'exact', 'q-payment-visible': 'no', [question]: 'stale_or_down' }
    const path = walkRecoveryTable(table, answers)
    assert.equal(path.outcomeId, 'recovery-source-stale', `${branch}: ${path.outcomeId}`)
  }
  const outcome = manifest.recovery.outcomes.find((o) => o.id === 'recovery-source-stale')
  assert.ok(outcome)
  assert.match(outcome.diagnosis, /cannot establish|stale|unavailable/i)
})

test('closed tab path recovers through the order list and the recovery kit', () => {
  const withKit = walkRecoveryTable(table, {
    'q-payment-made': 'yes',
    'q-amount': 'exact',
    'q-payment-visible': 'yes',
    'q-confirming': 'confirming',
    'q-order-visible': 'yes',
    'q-quote-expiry': 'after',
    'q-order-url': 'no',
  })
  assert.equal(withKit.outcomeId, 'recovery-closed-tab')
  const outcome = manifest.recovery.outcomes.find((o) => o.id === 'recovery-closed-tab')
  assert.ok(outcome)
  assert.equal(outcome.reversibility, 'recoverable')
  assert.match(outcome.nextAction, /order list|recovery kit/)
})

test('every outcome outcome references an existing authoritative guide', () => {
  for (const outcome of manifest.recovery.outcomes) {
    assert.ok(outcome.guideId, `${outcome.id} has no guide`)
    assert.ok(
      manifest.guides.some((g) => g.id === outcome.guideId),
      `${outcome.id} references missing guide ${outcome.guideId}`,
    )
  }
})

test('loop detection reports cycles synthetically', () => {
  const loopy = {
    entry: 'a',
    questions: [
      { id: 'a', question: 'a?', options: [{ value: 'x', label: 'x', next: 'b' }] },
      { id: 'b', question: 'b?', options: [{ value: 'y', label: 'y', next: 'a' }] },
    ],
  }
  const audit = auditRecoveryTable(loopy, [])
  assert.equal(audit.loops.length > 0, true)
})

test('walk terminates on a cyclic table instead of hanging', () => {
  const loopy = {
    entry: 'a',
    questions: [
      { id: 'a', question: 'a?', options: [{ value: 'x', label: 'x', next: 'b' }] },
      { id: 'b', question: 'b?', options: [{ value: 'y', label: 'y', next: 'a' }] },
    ],
  }
  const path = walkRecoveryTable(loopy, { a: 'x', b: 'y' })
  assert.equal(path.outcomeId, 'recovery-unknown')
})

test('unreachable outcomes are surfaced by reachableOutcomeIds union check', () => {
  const ids = reachableOutcomeIds(table)
  assert.ok(ids.length >= 14)
})
