import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseManifest } from '../src/schemas.ts'
import { buildInscribeLink, parseInscribeLink, assertNoSensitiveValue, assertApprovedReturn, UnsafeLinkError } from '../src/deep-links.ts'
import type { DeepLinkIntent } from '../src/schemas.ts'

const here = dirname(fileURLToPath(import.meta.url))
const manifest = parseManifest(
  JSON.parse(readFileSync(join(here, '..', 'data', 'inscribe-learning.manifest.json'), 'utf8')),
)

const APPROVED = manifest.docsReturnOrigins

test('every workflow intent round-trips through the builder and the parser', () => {
  for (const workflow of manifest.workflows) {
    const href = buildInscribeLink({
      appOrigin: manifest.appOrigin,
      intent: { workspace: workflow.workspace, sub: workflow.subview, ...workflow.intent, network: 'mainnet' } as DeepLinkIntent,
      docsReturnOrigins: APPROVED,
    })
    const parsed = parseInscribeLink(href)
    assert.equal(parsed.workspace, workflow.workspace, workflow.id)
    assert.equal(parsed.action, workflow.intent.action, workflow.id)
  }
})

test('links never contain addresses, transaction ids, outpoints, or PSBT material', () => {
  for (const workflow of manifest.workflows) {
    const href = buildInscribeLink({
      appOrigin: manifest.appOrigin,
      intent: { workspace: workflow.workspace, ...workflow.intent } as DeepLinkIntent,
      docsReturnOrigins: APPROVED,
    })
    assert.doesNotMatch(href, /bc1|tb1|[0-9a-f]{64}/i, workflow.id)
    assert.ok(!href.includes('psbt'), workflow.id)
  }
})

test('sensitive values are refused by the guard', () => {
  assert.throws(() => assertNoSensitiveValue('receiver', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'), UnsafeLinkError)
  assert.throws(() => assertNoSensitiveValue('tx', 'a'.repeat(64)), UnsafeLinkError)
  assert.throws(() => assertNoSensitiveValue('outpoint', 'abc:def'), UnsafeLinkError)
  assert.doesNotThrow(() => assertNoSensitiveValue('guide', 'inscribe-text'))
})

test('docsReturn accepts approved origins and relative paths, rejects strangers', () => {
  assert.doesNotThrow(() => assertApprovedReturn('https://bitcoinuniverseio.github.io/docs-inscribe/guided/', APPROVED))
  assert.doesNotThrow(() => assertApprovedReturn('/guided/?goal=inscribe_text', APPROVED))
  assert.throws(() => assertApprovedReturn('https://evil.example.com/guided/', APPROVED), UnsafeLinkError)
  assert.throws(() => assertApprovedReturn('../secrets', APPROVED), UnsafeLinkError)
})

test('handoff URLs survive query encoding of structured values', () => {
  const href = buildInscribeLink({
    appOrigin: 'https://inscribe.bitcoinuniverse.io',
    intent: {
      workspace: 'inscribe',
      sub: 'text',
      action: 'inscribe',
      guide: 'inscribe-text',
      step: 'inscribe-text_set-the-receiver-and-fee',
      scenario: 'ps-ordinals-inscribe-text',
      docsReturn: '/guided/',
      network: 'mainnet',
    },
    docsReturnOrigins: APPROVED,
  })
  const url = new URL(href)
  assert.equal(url.origin, 'https://inscribe.bitcoinuniverse.io')
  assert.equal(url.searchParams.get('step'), 'inscribe-text_set-the-receiver-and-fee')
  const parsed = parseInscribeLink(href)
  assert.equal(parsed.scenario, 'ps-ordinals-inscribe-text')
})

test('disallowed query keys never leave the builder', () => {
  const href = buildInscribeLink({
    appOrigin: 'https://inscribe.bitcoinuniverse.io',
    intent: { workspace: 'inscribe', action: 'inscribe' },
    docsReturnOrigins: APPROVED,
  })
  const url = new URL(href)
  for (const forbidden of ['address', 'receiver', 'order', 'tx', 'amount', 'psbt', 'capability', 'token']) {
    assert.equal(url.searchParams.has(forbidden), false, forbidden)
  }
})
