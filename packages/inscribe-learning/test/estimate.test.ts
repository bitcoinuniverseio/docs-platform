import test from 'node:test'
import assert from 'node:assert/strict'
import { estimateWorkflow, SERVICE_FEE_SATS, estimateScriptLen, revealVbytes, PARENT_REVEAL_EXTRA_VBYTES } from '../src/estimate/index.ts'
import type { EstimateInput, EstimateBreakdown } from '../src/estimate/index.ts'

const RECEIVER = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'

// Golden vectors: pinned outputs of the shared estimator. Any change to the
// formula must update these pins deliberately, in the same commit as the
// formula change, with the production estimator parity test in inscribe.
const GOLDEN: Array<{ name: string; input: EstimateInput; total: number; net: number; svc: number; out: number; rvb: number | null }> = [
  { name: 'ord text 100B at 40 sat/vB', input: { feeModel: 'commit_reveal', contentSizeBytes: 100, itemCount: 1, feeRateSatVb: 40 }, total: 6906, net: 6360, svc: 0, out: 546, rvb: 159 },
  { name: 'ord file 500KB at 40 sat/vB', input: { feeModel: 'commit_reveal', contentSizeBytes: 512000, itemCount: 1, feeRateSatVb: 40 }, total: 5155466, net: 5154920, svc: 0, out: 546, rvb: 128873 },
  { name: 'ord batch 10x1KB at 50 sat/vB', input: { feeModel: 'commit_reveal', contentSizeBytes: 1024, itemCount: 10, feeRateSatVb: 50 }, total: 226410, net: 220950, svc: 0, out: 5460, rvb: 391 },
  { name: 'ord batch with parent at 50 sat/vB', input: { feeModel: 'commit_reveal', contentSizeBytes: 1024, itemCount: 10, feeRateSatVb: 50, withParent: true }, total: 276910, net: 271450, svc: 0, out: 5460, rvb: 492 },
  { name: 'rune mint 1 at 40 sat/vB', input: { feeModel: 'keyless_p2a', contentSizeBytes: 0, itemCount: 1, feeRateSatVb: 40, receiverAddress: RECEIVER }, total: 9526, net: 7480, svc: 1500, out: 546, rvb: null },
  { name: 'rune keyless 100 at 40 sat/vB', input: { feeModel: 'keyless_p2a', contentSizeBytes: 0, itemCount: 100, feeRateSatVb: 40, receiverAddress: RECEIVER }, total: 370910, net: 166310, svc: 150000, out: 54600, rvb: null },
  { name: 'src20 mint at 40 sat/vB', input: { feeModel: 'src20', contentSizeBytes: 0, itemCount: 1, feeRateSatVb: 40 }, total: 11570, net: 10070, svc: 1500, out: 0, rvb: null },
  { name: 'src20 bulk 50 at 40 sat/vB', input: { feeModel: 'src20', contentSizeBytes: 0, itemCount: 50, feeRateSatVb: 40 }, total: 668900, net: 593900, svc: 75000, out: 0, rvb: null },
  { name: 'stamp 100KB at 40 sat/vB', input: { feeModel: 'stamp_olga', contentSizeBytes: 102400, itemCount: 1, feeRateSatVb: 40 }, total: 6567476, net: 6567476, svc: 0, out: 0, rvb: null },
]

for (const vector of GOLDEN) {
  test(`golden vector: ${vector.name}`, () => {
    const result = estimateWorkflow(vector.input)
    assert.equal(result.totalFundingSats, vector.total, 'total funding')
    assert.equal(result.networkFeeSats, vector.net, 'network fee')
    assert.equal(result.serviceFeeSats, vector.svc, 'service fee')
    assert.equal(result.outputValueSats, vector.out, 'output value')
    assert.equal(result.revealVbytes, vector.rvb, 'reveal vbytes')
    // The breakdown must always add up.
    assert.equal(
      result.networkFeeSats + result.serviceFeeSats + result.outputValueSats,
      result.totalFundingSats,
      'components must sum to the total',
    )
  })
}

test('every estimate states that the in-app quote is authoritative', () => {
  for (const vector of GOLDEN) {
    const result = estimateWorkflow(vector.input)
    assert.equal(result.authoritativeSource, 'inscribe_app_quote')
    assert.ok(result.assumptions.join(' ').match(/authoritative/i))
  }
})

test('parent reveal adds exactly the documented extra vbytes', () => {
  const plain = estimateWorkflow({ feeModel: 'commit_reveal', contentSizeBytes: 1024, itemCount: 10, feeRateSatVb: 50 })
  const withParent = estimateWorkflow({ feeModel: 'commit_reveal', contentSizeBytes: 1024, itemCount: 10, feeRateSatVb: 50, withParent: true })
  assert.equal((withParent.revealVbytes as number) - (plain.revealVbytes as number), PARENT_REVEAL_EXTRA_VBYTES)
})

test('script length and reveal vbytes are monotonic in content size', () => {
  let lastLen = 0
  let lastVb = 0
  for (const size of [1, 100, 1000, 10000, 100000]) {
    const len = estimateScriptLen('text/plain', size)
    const vb = revealVbytes(len)
    assert.ok(len >= lastLen)
    assert.ok(vb >= lastVb)
    lastLen = len
    lastVb = vb
  }
})

test('service fee is the documented flat 1500 sats', () => {
  assert.equal(SERVICE_FEE_SATS, 1500)
})
