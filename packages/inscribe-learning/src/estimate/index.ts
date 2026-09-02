/**
 * Public estimation primitives. These wrap the pure Inscribe estimator (ported
 * verbatim so one formula serves the app, the documentation, and the MCP
 * tools). Nothing here performs I/O: a caller supplies the fee rate, and the
 * result states whether that rate was live, user entered, or a snapshot.
 *
 * The final in-app quote is always authoritative. These numbers are teaching
 * previews, not quotes.
 */
import {
  PARENT_REVEAL_EXTRA_VBYTES,
  estimateScriptLen,
  estimateStampTotalSats,
  estimateTotalSats,
  estimateRuneMintTotalSats,
  estimateRuneMintReceiverDustSats,
  estimateKeylessPayToAnchorRuneMintTotalSats,
  estimateAlkaneMintTotalSats,
  estimateSrc20TotalSats,
  estimateSrc20BulkTotalSats,
  revealVbytes,
} from './inscriptionFee.ts'
import type { Workflow } from '../schemas.ts'

export {
  PARENT_REVEAL_EXTRA_VBYTES,
  estimateScriptLen,
  estimateStampTotalSats,
  estimateTotalSats,
  estimateRuneMintTotalSats,
  estimateKeylessPayToAnchorRuneMintTotalSats,
  estimateAlkaneMintTotalSats,
  estimateSrc20TotalSats,
  estimateSrc20BulkTotalSats,
  revealVbytes,
  satsToBtc,
} from './inscriptionFee.ts'

export const SERVICE_FEE_SATS = 1500

export type EstimateRateKind = 'user_entered' | 'live' | 'offline_snapshot'

export interface EstimateInput {
  feeModel: Workflow['feeModel']
  contentType?: string
  contentSizeBytes: number
  itemCount: number
  feeRateSatVb: number
  rateKind?: EstimateRateKind
  /** Parent inscription carried through a child reveal. */
  withParent?: boolean
  isP2wpkhReceiver?: boolean
  receiverAddress?: string
  /** SRC-20 style JSON payload, counted not stored. */
  jsonPayload?: string
}

export interface EstimateBreakdown {
  feeModel: Workflow['feeModel']
  commitVbytes: number | null
  revealVbytes: number | null
  networkFeeSats: number
  serviceFeeSats: number
  /** Postage and output value that stays owned by the user. */
  outputValueSats: number
  totalFundingSats: number
  assumptions: string[]
  rateKind: EstimateRateKind
  /** The in-app quote is authoritative; this preview is not a quote. */
  authoritativeSource: 'inscribe_app_quote'
}

export function estimateWorkflow(input: EstimateInput): EstimateBreakdown {
  const rateKind: EstimateRateKind = input.rateKind ?? 'user_entered'
  const items = Math.max(1, Math.floor(input.itemCount))
  const assumptions: string[] = [
    `Fee rate ${input.feeRateSatVb} sat/vB (${rateKind.replace('_', ' ')}).`,
    'The final Inscribe quote is authoritative. This preview is for understanding only.',
  ]

  switch (input.feeModel) {
    case 'commit_reveal':
    case 'direct': {
      const contentType = input.contentType ?? 'text/plain'
      const scriptLen = estimateScriptLen(contentType, input.contentSizeBytes)
      const extra = input.withParent ? PARENT_REVEAL_EXTRA_VBYTES : 0
      const isP2wpkh = input.isP2wpkhReceiver ?? true
      const total = estimateTotalSats(scriptLen, input.feeRateSatVb, items, isP2wpkh, extra, 546)
      const rvb = revealVbytes(scriptLen) + extra
      const revealFee = Math.ceil(rvb * input.feeRateSatVb)
      const outputValueSats = 546 * items
      return {
        feeModel: input.feeModel,
        commitVbytes: null,
        revealVbytes: rvb,
        networkFeeSats: Math.max(0, total - outputValueSats),
        serviceFeeSats: 0,
        outputValueSats,
        totalFundingSats: total,
        assumptions: [
          ...assumptions,
          'Commit transaction size depends on the funding inputs the wallet picks, so only the reveal virtual bytes are shown.',
          'Inscription outputs keep 546 sats of postage that stays owned by the user and moves with the asset.',
        ],
        rateKind,
        authoritativeSource: 'inscribe_app_quote',
      }
    }
    case 'stamp_olga': {
      const total = estimateStampTotalSats(input.contentSizeBytes, input.feeRateSatVb)
      return {
        feeModel: 'stamp_olga',
        commitVbytes: null,
        revealVbytes: null,
        networkFeeSats: total,
        serviceFeeSats: 0,
        outputValueSats: 0,
        totalFundingSats: total,
        assumptions: [...assumptions, 'Stamp estimates use the OLGA stamp chain model for the given image size.'],
        rateKind,
        authoritativeSource: 'inscribe_app_quote',
      }
    }
    case 'keyless_p2a': {
      if (!input.receiverAddress) {
        throw new Error('keyless_p2a estimates need a receiver address shape; use a test address, never a real one you do not control')
      }
      const serviceFee = SERVICE_FEE_SATS * items
      const receiverDust = estimateRuneMintReceiverDustSats(input.receiverAddress) * items
      const total =
        items >= 2
          ? estimateKeylessPayToAnchorRuneMintTotalSats(items, input.feeRateSatVb, input.receiverAddress, SERVICE_FEE_SATS)
          : estimateRuneMintTotalSats(items, input.feeRateSatVb, input.receiverAddress, SERVICE_FEE_SATS)
      return {
        feeModel: 'keyless_p2a',
        commitVbytes: null,
        revealVbytes: null,
        networkFeeSats: Math.max(0, total - serviceFee - receiverDust),
        serviceFeeSats: serviceFee,
        outputValueSats: receiverDust,
        totalFundingSats: total,
        assumptions: [
          ...assumptions,
          'Keyless batch mints use pay-to-anchor chains. Batches of two or more use the keyless pricing path.',
          `Service fee is ${SERVICE_FEE_SATS} sats per mint, shown separately from the network fee.`,
        ],
        rateKind,
        authoritativeSource: 'inscribe_app_quote',
      }
    }
    case 'src20': {
      const json = input.jsonPayload ?? JSON.stringify({ p: 'src-20', op: 'mint', tick: 'test', amt: '1' })
      const total =
        items > 1
          ? estimateSrc20BulkTotalSats(json, input.feeRateSatVb, SERVICE_FEE_SATS, items)
          : estimateSrc20TotalSats(json, input.feeRateSatVb, SERVICE_FEE_SATS)
      const serviceFee = SERVICE_FEE_SATS * items
      return {
        feeModel: 'src20',
        commitVbytes: null,
        revealVbytes: null,
        networkFeeSats: Math.max(0, total - serviceFee),
        serviceFeeSats: serviceFee,
        outputValueSats: 0,
        totalFundingSats: total,
        assumptions: [...assumptions, 'SRC-20 mints pay dust on every data output; that dust is spent as fees by the design of the protocol.'],
        rateKind,
        authoritativeSource: 'inscribe_app_quote',
      }
    }
    case 'service_quote': {
      // Models where the app obtains a quote (drops, atomicals operations with
      // server-side construction). No offline formula is claimed.
      return {
        feeModel: 'service_quote',
        commitVbytes: null,
        revealVbytes: null,
        networkFeeSats: 0,
        serviceFeeSats: SERVICE_FEE_SATS,
        outputValueSats: 0,
        totalFundingSats: 0,
        assumptions: [
          ...assumptions,
          'This workflow quotes in the app. No offline formula is published, so the preview shows only the service fee component.',
        ],
        rateKind,
        authoritativeSource: 'inscribe_app_quote',
      }
    }
  }
}
