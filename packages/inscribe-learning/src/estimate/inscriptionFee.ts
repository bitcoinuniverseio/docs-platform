/**
 * Frontend inscription fee estimator.
 * Mirrors backend/src/inscribe/bitcoin.utils.ts so costs are accurate
 * without any server round-trip.
 */

const CHAIN_LIMIT = 24  // max reveals per temp fan-out TX
// Each publicly spendable continuation path stays short. Larger opted-in
// batches use one controlled P2WPKH fan-out, then several independent short
// P2A chains, matching the server's relay-safe batch plan.
export const KEYLESS_PAY_TO_ANCHOR_CHAIN_LIMIT = 22
export const KEYLESS_PAY_TO_ANCHOR_MAX_BATCH_MINTS = 1_000
const DIRECT_LIMIT = 22 // items ≤ this use direct fan-out (no temp addresses)

/** Extra vbytes for a parent/child reveal: one P2TR key-path input (41+ceil(66/4)) + one P2TR return output (43). */
export const PARENT_REVEAL_EXTRA_VBYTES = 41 + 43 + Math.ceil(66 / 4) // = 101

// ── Script size helpers ───────────────────────────────────────────────────────

function varIntSize(n: number): number {
  if (n < 0xfd) return 1
  if (n <= 0xffff) return 3
  return 5
}

/** Compiled byte count for a pushdata element of `dataLen` bytes. */
function compiledPushSize(dataLen: number): number {
  if (dataLen <= 75) return 1 + dataLen   // 1-byte opcode + data
  if (dataLen <= 255) return 2 + dataLen  // OP_PUSHDATA1 + 1-byte len + data
  return 3 + dataLen                       // OP_PUSHDATA2 + 2-byte len + data (max chunk 520 B)
}

/**
 * Estimate the compiled ord inscription script length in bytes.
 * Mirrors buildInscriptionScript() in bitcoin.utils.ts.
 */
export function estimateScriptLen(contentType: string, contentSizeBytes: number): number {
  const ctBytes = new TextEncoder().encode(contentType).length
  let len = 0
  len += compiledPushSize(32)           // xOnlyPubkey (32 B)
  len += 1                              // OP_CHECKSIG
  len += 1                              // OP_FALSE
  len += 1                              // OP_IF
  len += compiledPushSize(3)            // 'ord' (3 B)
  len += 1                              // OP_1
  len += compiledPushSize(ctBytes)      // content-type string
  len += 1                              // OP_0 (body tag)
  const numChunks = contentSizeBytes > 0 ? Math.ceil(contentSizeBytes / 520) : 0
  for (let i = 0; i < numChunks; i++) {
    const chunkSize = Math.min(520, contentSizeBytes - i * 520)
    len += compiledPushSize(chunkSize)
  }
  len += 1                              // OP_ENDIF
  return len
}

/**
 * Estimate the deployed BIP-110 op-drop inscription leaf. This mirrors the
 * fixed marker/content-type/hash/payload layout in the backend so a
 * strict op-drop quote does not use the larger legacy Ordinals envelope.
 */
export function estimateBip110OpDropScriptLen(jsonSizeBytes: number): number {
  const markerBytes = new TextEncoder().encode('bip110-op-drop').length
  const contentTypeBytes = new TextEncoder().encode('application/json').length
  const payloadBytes = Math.max(0, jsonSizeBytes)

  return (
    compiledPushSize(markerBytes)
    + 1 // OP_DROP
    + compiledPushSize(contentTypeBytes)
    + 1 // OP_DROP
    + compiledPushSize(32) // SHA-256 payload hash
    + 1 // OP_DROP
    + compiledPushSize(payloadBytes)
    + 1 // OP_DROP
    + compiledPushSize(32) // x-only public key
    + 1 // OP_CHECKSIG
  )
}

/** Delegate inscriptions use buildDelegateScript() which produces a fixed ~76-byte script. */
export const DELEGATE_SCRIPT_LEN = 76

// ── Transaction size helpers ──────────────────────────────────────────────────

/** Reveal tx vbytes for a given inscription script length. */
export function revealVbytes(scriptLen: number): number {
  const sigLen = 64
  const ctrlLen = 33
  const witnessBytes =
    1 + 1 + sigLen + varIntSize(scriptLen) + scriptLen + varIntSize(ctrlLen) + ctrlLen
  const baseBytes = 4 + 4 + 1 + 1 + 41 + 43
  return baseBytes + Math.ceil(witnessBytes / 4)
}

/** 1-input P2WPKH → numOutputs fan-out tx vbytes (same formula as backend estimateFanOutVbytes). */
function fanOutVbytes(numOutputs: number, outputsAreP2tr: boolean): number {
  const outputSize = outputsAreP2tr ? 43 : 31
  const nonWitness = 51 + numOutputs * outputSize
  return Math.ceil((nonWitness * 4 + 110) / 4) // 110 = 2 segwit overhead + 108 P2WPKH witness
}

// ── Public cost estimator ─────────────────────────────────────────────────────

/**
 * Estimate total inscription cost in satoshis.
 *
 * @param scriptLen        Compiled inscription script length (bytes) for ONE item.
 * @param feeRateSatVb     Network fee rate (sat/vB).
 * @param itemCount        Number of inscriptions.
 * @param isP2wpkhReceiver Receiver is bc1q / tb1q (dust = 294 sat vs 546 sat).
 */
function inscriptionOutputSats(outputValue: number, isP2wpkhReceiver: boolean): number {
  if (outputValue >= 330) return outputValue
  return isP2wpkhReceiver ? 294 : 546
}

export function estimateTotalSats(
  scriptLen: number,
  feeRateSatVb: number,
  itemCount: number,
  isP2wpkhReceiver: boolean,
  extraVbytes = 0,
  inscriptionOutputValue = 0,
): number {
  const n = Math.max(1, itemCount)
  const rate = Math.max(0.01, feeRateSatVb)
  const dust = inscriptionOutputSats(inscriptionOutputValue, isP2wpkhReceiver)
  const revealFee = Math.ceil((revealVbytes(scriptLen) + extraVbytes) * rate)
  const commitAmount = revealFee + dust // sats per inscription commit address

  if (n === 1) {
    // Single: user funds commit address directly, no fan-out overhead
    return commitAmount
  }

  // Bulk: single payment address → fan-out → commit addresses → reveals
  let fanoutSats = 0
  const C = Math.ceil(n / CHAIN_LIMIT)

  if (n <= DIRECT_LIMIT) {
    // ≤22: direct fan-out - payment → N P2TR commit outputs (no temp addresses)
    fanoutSats = Math.ceil(fanOutVbytes(n, true) * rate)
  } else {
    // >22: phase1 payment→C P2WPKH temps, phase2 each temp→≤24 P2TR commits
    fanoutSats += Math.ceil(fanOutVbytes(C, false) * rate)
    for (let i = 0; i < C; i++) {
      const chunkSize = Math.min(CHAIN_LIMIT, n - i * CHAIN_LIMIT)
      fanoutSats += Math.ceil(fanOutVbytes(chunkSize, true) * rate)
    }
  }

  return fanoutSats + n * commitAmount
}

/** Format satoshis as a BTC string. */
export function satsToBtc(sats: number): string {
  return (sats / 100_000_000).toFixed(8) + ' BTC'
}

// ── Gallery cost estimator ────────────────────────────────────────────────────

export interface GalleryItem {
  id: string
  title?: string
  traits?: Record<string, string | boolean | number | null>
}

function cborContainerLength(n: number): number {
  return n <= 23 ? 1 : n <= 255 ? 2 : 3
}

function cborUnsignedLength(n: number): number {
  if (n <= 23) return 1
  if (n <= 255) return 2
  if (n <= 65535) return 3
  return 5
}
function cborNegativeLength(n: number): number {
  const v = -(n + 1)
  return v <= 23 ? 1 : v <= 255 ? 2 : 3
}
function cborBytesLength(len: number): number {
  return len <= 23 ? 1 : len <= 255 ? 2 : 3
}
function cborTextLength(value: string): number {
  const byteLength = new TextEncoder().encode(value).length
  return cborBytesLength(byteLength) + byteLength
}

function galleryPropertiesByteLen(items: GalleryItem[]): number {
  let length = cborContainerLength(1) + cborUnsignedLength(0) + cborContainerLength(items.length)
  for (const item of items) {
    // InscriptionId bytes: 32 (txid LE) + 0-4 (index LE stripped)
    const m = /^[0-9a-fA-F]{64}i(\d+)$/.exec(item.id)
    const index = m ? parseInt(m[1], 10) : 0
    const indexBytes = index === 0 ? 0 : index < 0x100 ? 1 : index < 0x10000 ? 2 : index < 0x1000000 ? 3 : 4
    const idLen = 32 + indexBytes
    const traits = item.traits ?? {}
    const traitKeys = Object.keys(traits)
    const hasTitle = !!item.title
    const hasTraits = traitKeys.length > 0
    const hasAttribs = hasTitle || hasTraits
    length += cborContainerLength(hasAttribs ? 2 : 1)
      + cborUnsignedLength(0)
      + cborBytesLength(idLen)
      + idLen
    if (hasAttribs) {
      length += cborUnsignedLength(1)
        + cborContainerLength((hasTitle ? 1 : 0) + (hasTraits ? 1 : 0))
      if (hasTitle) length += cborUnsignedLength(0) + cborTextLength(item.title!)
      if (hasTraits) {
        length += cborUnsignedLength(1) + cborContainerLength(traitKeys.length)
        for (const key of traitKeys) {
          length += cborTextLength(key)
          const val = traits[key]
          if (val === null || typeof val === 'boolean') length += 1
          else if (typeof val === 'number' && Number.isInteger(val)) {
            length += val >= 0 ? cborUnsignedLength(val) : cborNegativeLength(val)
          } else length += cborTextLength(String(val))
        }
      }
    }
  }
  return length
}

/**
 * Estimate total cost in satoshis for a gallery inscription.
 */
export function estimateGalleryTotalSats(
  items: GalleryItem[],
  feeRate: number,
  isP2wpkhReceiver: boolean,
): number {
  const cborLen = galleryPropertiesByteLen(items)
  const PROPERTIES_TAG = 17
  const MAX_CHUNK = 520
  // script length: xOnlyPubkey(33) + OP_CHECKSIG(1) + OP_FALSE(1) + OP_IF(1) + 'ord'(4) + property chunks + OP_ENDIF(1)
  let scriptLen = 33 + 1 + 1 + 1 + 4 + 1
  for (let offset = 0; offset < cborLen; offset += MAX_CHUNK) {
    const chunkSize = Math.min(MAX_CHUNK, cborLen - offset)
    scriptLen += 2 // push 1-byte tag (1 opcode + 1 data byte)
    scriptLen += chunkSize <= 75 ? 1 + chunkSize : chunkSize <= 255 ? 2 + chunkSize : 3 + chunkSize
  }
  const sigLen = 64, ctrlLen = 33
  const witnessBytes = 1 + 1 + sigLen + varIntSize(scriptLen) + scriptLen + varIntSize(ctrlLen) + ctrlLen
  const baseBytes = 4 + 4 + 1 + 1 + 41 + 43
  const vbytes = baseBytes + Math.ceil(witnessBytes / 4)
  const dust = isP2wpkhReceiver ? 294 : 546
  return Math.ceil(vbytes * Math.max(0.01, feeRate)) + dust
  // suppress unused import warning
  void PROPERTIES_TAG
}

// ── Stamp cost estimator (OLGA direct format) ────────────────────────────────

const DUST_STAMP = 330

// OLGA header: 2-byte length + "stamp:" (6 bytes) = 8 bytes overhead
function stampNumChunks(imageSize: number): number {
  return Math.ceil((imageSize + 8) / 32)
}

// OLGA: vout[0]=P2TR receiver(43B) + vout[1..N]=P2WSH data chunks(43B each)
function stampVbytes(imageSize: number): number {
  const numChunks = stampNumChunks(imageSize)
  const nonWitness = 4 + 1 + 41 + 1 + 43 + numChunks * 43 + 4
  return Math.ceil((nonWitness * 4 + 110) / 4)
}

/**
 * Estimate total cost in satoshis for a Bitcoin Stamps OLGA transaction.
 */
export function estimateStampTotalSats(imageSize: number, feeRate: number, fileName = 'stamp.png'): number {
  void fileName
  const rate = Math.max(0.01, feeRate)
  const txFee = Math.ceil(stampVbytes(imageSize) * rate)
  return txFee + stampNumChunks(imageSize) * DUST_STAMP + 546 // 546 = receiver dust (P2TR)
}

// ── Rune mint cost estimator ──────────────────────────────────────────────────
// Mirrors backend calcRuneChainCost + fan-out cost in bitcoin.utils.ts

const P2WPKH_OUT = 31
// OP_1 <0x4e73> (`bc1pfeessrawgf`) has a 4-byte script, or 13 bytes including
// the output value and script-length fields.
const PAY_TO_ANCHOR_OUT = 13
const RUNE_SCRIPT_LEN = 13 // typical OP_RETURN+OP_13+payload compiled length
const DEFAULT_DUST_RELAY_SATS_PER_VBYTE = 3
const WITNESS_DUST_SPEND_VBYTES = 67
const CONSERVATIVE_LEGACY_DUST_SATS = 546
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const BECH32_CHECKSUM = 1
const BECH32M_CHECKSUM = 0x2bc830a3

type WitnessAddressLayout = {
  version: number
  programBytes: number
  outputBytes: number
}

function bech32Polymod(values: number[]): number {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let checksum = 1
  for (const value of values) {
    const top = checksum >>> 25
    checksum = ((checksum & 0x1ffffff) << 5) ^ value
    for (let bit = 0; bit < generators.length; bit++) {
      if ((top >>> bit) & 1) checksum ^= generators[bit]
    }
  }
  return checksum >>> 0
}

function hasValidBech32Checksum(hrp: string, data: string, witnessVersion: number): boolean {
  const values = [
    ...[...hrp].map((char) => char.charCodeAt(0) >>> 5),
    0,
    ...[...hrp].map((char) => char.charCodeAt(0) & 31),
    ...[...data].map((char) => BECH32_CHARSET.indexOf(char)),
  ]
  const expected = witnessVersion === 0 ? BECH32_CHECKSUM : BECH32M_CHECKSUM
  return bech32Polymod(values) === expected
}

/** Number of bytes emitted by `encodeLeb128()` for a non-negative safe integer. */
function leb128Size(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) return 0
  let remaining = value
  let size = 1
  while (remaining >= 0x80) {
    remaining = Math.floor(remaining / 0x80)
    size++
  }
  return size
}

/**
 * Exact byte length of the Runestone mint script built by the backend for a
 * `block:tx` Rune ID. A malformed or unresolved ID retains the existing
 * preview fallback so the form can render before a token lookup completes.
 */
export function estimateRuneMintScriptLength(runeId?: string): number {
  const match = /^\s*(\d+):(\d+)\s*$/.exec(runeId ?? '')
  if (!match) return RUNE_SCRIPT_LEN

  const block = Number(match[1])
  const txIndex = Number(match[2])
  if (!Number.isSafeInteger(block) || block < 1 || !Number.isSafeInteger(txIndex) || txIndex < 0) {
    return RUNE_SCRIPT_LEN
  }

  // buildRuneMintScript() compiles OP_RETURN, OP_13, then one pushed LEB128
  // payload: tag(20), block, tag(22), tx index.
  const payloadLength = leb128Size(20) + leb128Size(block) + leb128Size(22) + leb128Size(txIndex)
  return 2 + compiledPushSize(payloadLength)
}

/**
 * Infer a structurally valid Bech32/Bech32m witness layout without adding a
 * Bitcoin library to the browser bundle. This is intentionally stricter than
 * a prefix check so unknown encodings can keep the conservative dust floor.
 */
function estimateWitnessAddressLayout(address: string): WitnessAddressLayout | null {
  const value = address.trim()
  if (value !== value.toLowerCase() && value !== value.toUpperCase()) return null
  const lower = value.toLowerCase()

  const separator = lower.lastIndexOf('1')
  const hrp = separator > 0 ? lower.slice(0, separator) : ''
  if (hrp !== 'bc' && hrp !== 'tb' && hrp !== 'bcrt') return null

  const data = lower.slice(separator + 1)
  if (data.length < 8 || [...data].some((char) => !BECH32_CHARSET.includes(char))) {
    return null
  }

  // Bech32 witness data is one version symbol, a program converted to five-bit
  // groups, then a six-symbol checksum.
  const version = BECH32_CHARSET.indexOf(data[0])
  const programChars = data.length - 1 - 6
  const programBytes = Math.floor((programChars * 5) / 8)
  const programValues = [...data.slice(1, -6)].map((char) => BECH32_CHARSET.indexOf(char))
  const paddingBits = programChars * 5 - programBytes * 8
  if (
    version < 0 ||
    version > 16 ||
    !hasValidBech32Checksum(hrp, data, version) ||
    programBytes < 2 ||
    programBytes > 40 ||
    Math.ceil((programBytes * 8) / 5) !== programChars ||
    // BIP173/350 conversion from 5-bit groups must use zero-only padding.
    // Otherwise a checksum-valid string can encode more bits than its stated
    // witness program length and bitcoinjs/libbitcoin rejects it.
    (paddingBits > 0 && (programValues.at(-1)! & ((1 << paddingBits) - 1)) !== 0)
  ) {
    return null
  }

  const scriptBytes = 2 + programBytes // witness opcode + compact program length + program
  return {
    version,
    programBytes,
    outputBytes: 8 + varIntSize(scriptBytes) + scriptBytes,
  }
}

/**
 * Serialized output size for a Bitcoin address. This matches the backend's
 * `address.toOutputScript()` sizing for standard legacy and SegWit addresses
 * without pulling a Bitcoin library into the browser bundle. Unknown input
 * falls back to a P2TR-sized output so a preview never understates P2A fees.
 */
export function estimateBitcoinAddressOutputBytes(address: string): number {
  const value = address.trim()

  // Base58 P2PKH / P2SH output scripts are fixed-size.
  if (/^[1mn]/.test(value)) return 8 + varIntSize(25) + 25
  if (/^[32]/.test(value)) return 8 + varIntSize(23) + 23

  const witness = estimateWitnessAddressLayout(value)
  if (witness) return witness.outputBytes

  return 43 // conservative P2TR fallback
}

/**
 * Mirror Bitcoin Core's default dust policy for receiver outputs the backend
 * accepts: every valid witness program uses its serialized txout plus a
 * 67-vB spend at 3 sat/vB. That yields 294 sats for P2WPKH and 330 sats for
 * P2WSH/P2TR (and a 43-byte future witness program). Legacy or malformed
 * addresses retain the conservative 546-sat fallback.
 */
export function estimateRuneMintReceiverDustSats(receiverAddress: string): number {
  const witness = estimateWitnessAddressLayout(receiverAddress)
  if (!witness) return CONSERVATIVE_LEGACY_DUST_SATS
  return (witness.outputBytes + WITNESS_DUST_SPEND_VBYTES) * DEFAULT_DUST_RELAY_SATS_PER_VBYTE
}

// All TXs in a chain (intermediate + last) use the same 2-output structure:
//   OP_RETURN | self-or-receiver  (no separate change output)
function runeMintVbytes(
  runeScriptLen: number,
  receiverOutputBytes = P2WPKH_OUT,
  extraP2trOutputs = 0,
): number {
  const runeOut = 9 + runeScriptLen
  const nonWitness = 4 + 1 + 41 + 1 + runeOut + receiverOutputBytes + extraP2trOutputs * 43 + 4
  return Math.ceil((nonWitness * 4 + 110) / 4)
}

/**
 * The first transaction in a keyless chain still spends a signed P2WPKH
 * funding output, but sends its continuation to the fixed P2A script.
 */
function keylessRuneFirstMintVbytes(runeScriptLen: number, hasServiceFeeOutput: boolean): number {
  const runeOut = 9 + runeScriptLen
  const nonWitness = 4 + 1 + 41 + 1 + runeOut + PAY_TO_ANCHOR_OUT
    + (hasServiceFeeOutput ? 43 : 0) + 4
  return Math.ceil((nonWitness * 4 + 110) / 4)
}

/** A P2A input has no signature or witness data. */
function keylessRuneIntermediateMintVbytes(runeScriptLen: number): number {
  const runeOut = 9 + runeScriptLen
  return 4 + 1 + 41 + 1 + runeOut + PAY_TO_ANCHOR_OUT + 4
}

/** The last P2A transaction sends the Rune-bearing output to the receiver. */
function keylessRuneFinalMintVbytes(receiverAddress: string, runeScriptLen: number): number {
  const runeOut = 9 + runeScriptLen
  const receiverOut = estimateBitcoinAddressOutputBytes(receiverAddress)
  return 4 + 1 + 41 + 1 + runeOut + receiverOut + 4
}

function runeChainCost(
  n: number,
  rate: number,
  dust: number,
  runeScriptLen: number,
  receiverOutputBytes: number,
): number {
  if (n <= 0) return 0
  const intermediateFee = Math.ceil(runeMintVbytes(runeScriptLen) * rate)
  const finalFee = Math.ceil(runeMintVbytes(runeScriptLen, receiverOutputBytes) * rate)
  return Math.max(0, n - 1) * intermediateFee + finalFee + dust
}

function keylessRuneChainCost(
  n: number,
  rate: number,
  dust: number,
  receiverAddress: string,
  runeScriptLen: number,
  serviceFeeAmount: number,
): number {
  if (n <= 0) return 0
  // There is no useful P2A link for one mint. Keep that quote identical to
  // the standard path so the UI never advertises a saving where none exists.
  if (n === 1) {
    const receiverOutputBytes = estimateBitcoinAddressOutputBytes(receiverAddress)
    return runeChainCost(n, rate, dust, runeScriptLen, receiverOutputBytes)
      + (serviceFeeAmount > 0
        ? Math.ceil(runeMintVbytes(runeScriptLen, receiverOutputBytes, 1) * rate)
          - Math.ceil(runeMintVbytes(runeScriptLen, receiverOutputBytes) * rate)
        : 0)
      + serviceFeeAmount
  }

  const firstFee = Math.ceil(keylessRuneFirstMintVbytes(runeScriptLen, serviceFeeAmount > 0) * rate)
  const intermediateFee = Math.ceil(keylessRuneIntermediateMintVbytes(runeScriptLen) * rate)
  const finalFee = Math.ceil(keylessRuneFinalMintVbytes(receiverAddress, runeScriptLen) * rate)

  return firstFee + Math.max(0, n - 2) * intermediateFee + finalFee + dust + serviceFeeAmount
}

function runeFanoutVbytes(numP2wpkhOutputs: number, extraP2trOutputs = 0): number {
  const nonWitness = 51 + numP2wpkhOutputs * P2WPKH_OUT + extraP2trOutputs * 43
  return Math.ceil((nonWitness * 4 + 110) / 4)
}

/**
 * Estimate total cost in satoshis for a batch rune mint.
 * Mirrors the tier + fanout logic in runes.service.ts.
 */
export function estimateRuneMintTotalSats(
  n: number,
  feeRate: number,
  receiverAddress: string,
  serviceFeeAmount: number,
  receiverOutputValue?: number,
  runeScriptLen = RUNE_SCRIPT_LEN,
): number {
  const count = Math.max(1, n)
  const rate = Math.max(0.01, feeRate)
  const minimumDust = estimateRuneMintReceiverDustSats(receiverAddress)
  const dust = Math.max(receiverOutputValue ?? minimumDust, minimumDust)
  const scriptLen = Math.max(1, Math.floor(runeScriptLen))
  const receiverOutputBytes = estimateBitcoinAddressOutputBytes(receiverAddress)

  const chunks: number[] = []
  const k = Math.ceil(count / CHAIN_LIMIT)
  for (let i = 0; i < k; i++) chunks.push(Math.min(CHAIN_LIMIT, count - i * CHAIN_LIMIT))

  const totalChainCost = chunks.reduce(
    (s, size) => s + runeChainCost(size, rate, dust, scriptLen, receiverOutputBytes),
    0,
  )

  let fanoutCost = 0
  if (count === 1) {
    // direct: service fee is an extra P2TR output in the single mint TX (≈ 43 extra non-witness bytes)
    fanoutCost = serviceFeeAmount > 0
      ? Math.ceil(runeMintVbytes(scriptLen, receiverOutputBytes, 1) * rate)
        - Math.ceil(runeMintVbytes(scriptLen, receiverOutputBytes) * rate)
      : 0
  } else {
    fanoutCost = Math.ceil(runeFanoutVbytes(k, serviceFeeAmount > 0 ? 1 : 0) * rate)
  }

  return totalChainCost + fanoutCost + serviceFeeAmount
}

/**
 * Estimate a Rune batch that uses keyless Pay-to-Anchor continuations.
 *
 * The first transaction spends the payment UTXO and includes the service-fee
 * output; intermediate links spend `OP_1 <0x4e73>` directly. This direct path
 * avoids both a P2WPKH witness on continuations and a separate fan-out TX.
 * The real order quote remains server-authoritative because Runestone payload
 * length can vary by Rune ID.
 */
export function estimateKeylessPayToAnchorRuneMintTotalSats(
  n: number,
  feeRate: number,
  receiverAddress: string,
  serviceFeeAmount: number,
  receiverOutputValue?: number,
  runeScriptLen = RUNE_SCRIPT_LEN,
): number {
  const count = Math.max(1, n)
  // Preserve standard pricing if a stale client selection reaches this helper
  // outside the server's supported keyless batch range.
  if (count < 2 || count > KEYLESS_PAY_TO_ANCHOR_MAX_BATCH_MINTS) {
    return estimateRuneMintTotalSats(
      count,
      feeRate,
      receiverAddress,
      serviceFeeAmount,
      receiverOutputValue,
      runeScriptLen,
    )
  }

  const rate = Math.max(0.01, feeRate)
  const minimumDust = estimateRuneMintReceiverDustSats(receiverAddress)
  const dust = Math.max(receiverOutputValue ?? minimumDust, minimumDust)
  const scriptLen = Math.max(1, Math.floor(runeScriptLen))

  // Match buildKeylessPayToAnchorChunks() on the server. Balancing avoids a
  // one-mint tail while keeping every public P2A continuation chain at 22
  // transactions or fewer.
  const chainCount = Math.ceil(count / KEYLESS_PAY_TO_ANCHOR_CHAIN_LIMIT)
  const baseSize = Math.floor(count / chainCount)
  const remainder = count % chainCount
  const chunks = Array.from(
    { length: chainCount },
    (_, index) => baseSize + (index < remainder ? 1 : 0),
  )
  const usesControlledFanout = chunks.length > 1
  const chainCost = chunks.reduce(
    (total, size) => total + keylessRuneChainCost(
      size,
      rate,
      dust,
      receiverAddress,
      scriptLen,
      // A multi-chain batch pays its service fee exactly once in the
      // controlled fan-out, never once per public continuation chain.
      usesControlledFanout ? 0 : serviceFeeAmount,
    ),
    0,
  )

  if (!usesControlledFanout) return chainCost

  const fanoutFee = Math.ceil(
    runeFanoutVbytes(chunks.length, serviceFeeAmount > 0 ? 1 : 0) * rate,
  )
  return chainCost + fanoutFee + serviceFeeAmount
}

// ── Alkane mint cost estimator ────────────────────────────────────────────────
// Mirrors backend calcAlkaneChainCost + fan-out cost in bitcoin.utils.ts

// Typical alkane key is ~14 bytes (28 hex chars) → script = 3 + 14 = 17 bytes
const ALKANE_SCRIPT_LEN_APPROX = 17

function alkaneMintVbytes(alkaneScriptLen: number, isP2wpkhOutput: boolean): number {
  const P2TR_OUT = 43
  const alkaneOut = 9 + alkaneScriptLen
  const addrOut = isP2wpkhOutput ? P2WPKH_OUT : P2TR_OUT
  const nonWitness = 4 + 1 + 41 + 1 + alkaneOut + addrOut + 4
  return Math.ceil((nonWitness * 4 + 110) / 4)
}

function alkaneChainCost(n: number, rate: number, dust: number, isP2wpkhReceiver: boolean): number {
  if (n <= 0) return 0
  // TX[0]: mintKey, intermediate → self is P2WPKH
  // TX[1..n-2]: mintTransferKey, intermediate
  // TX[n-1]: mintTransferKey, last → receiver type
  // For the estimate we use the same approx script len for both keys
  const feeIntermediate = Math.ceil(alkaneMintVbytes(ALKANE_SCRIPT_LEN_APPROX, true) * rate)
  const feeLast = Math.ceil(alkaneMintVbytes(ALKANE_SCRIPT_LEN_APPROX, isP2wpkhReceiver) * rate)
  if (n === 1) return feeLast + dust
  return feeIntermediate * (n - 1) + feeLast + dust
}

/**
 * Estimate total cost in satoshis for an alkane batch mint.
 * Mirrors the tier + fanout logic in alkanes.service.ts.
 */
export function estimateAlkaneMintTotalSats(
  n: number,
  feeRate: number,
  receiverAddress: string,
  serviceFeeAmount: number,
): number {
  const count = Math.max(1, n)
  const rate = Math.max(0.01, feeRate)
  const isP2wpkhReceiver = receiverAddress.startsWith('bc1q') || receiverAddress.startsWith('tb1q')
  const dust = isP2wpkhReceiver ? 294 : 546

  const chunks: number[] = []
  const k = Math.ceil(count / CHAIN_LIMIT)
  for (let i = 0; i < k; i++) chunks.push(Math.min(CHAIN_LIMIT, count - i * CHAIN_LIMIT))

  const totalChainCost = chunks.reduce((s, size) => s + alkaneChainCost(size, rate, dust, isP2wpkhReceiver), 0)

  let fanoutCost = 0
  if (count === 1) {
    fanoutCost = serviceFeeAmount > 0 ? Math.ceil((43 / 4) * rate) : 0
  } else {
    fanoutCost = Math.ceil(runeFanoutVbytes(k + (serviceFeeAmount > 0 ? 1 : 0)) * rate)
  }

  return totalChainCost + fanoutCost + serviceFeeAmount
}

// ── SRC-20 P2WSH estimator ─────────────────────────────────────────────────────

const STAMP_PREFIX_LEN = 6   // "stamp:" = 6 bytes
const SRC20_DUST = 330       // sats per P2WSH output (matches backend DUST_VALUE)

/**
 * Estimate total cost in satoshis for a SRC-20 P2WSH (OLGA) transaction.
 * Mirrors estimateSrc20Vbytes() in backend/src/src20/src20.service.ts.
 * Does NOT clamp fee rate to 1 - sub-1 sat/vB rates are valid for SRC-20.
 */
export function estimateSrc20TotalSats(
  jsonStr: string,
  feeRate: number,
  serviceFeeAmount: number,
): number {
  const rawLen = STAMP_PREFIX_LEN + new TextEncoder().encode(jsonStr).length
  const prefixedLen = 2 + rawLen // 2-byte [0x00, length] header
  const numDataOutputs = Math.ceil(prefixedLen / 32)
  const numInputs = 1 // single UTXO for frontend estimate
  const nonWitness = 4 + 1 + numInputs * 41 + 1 + 31 + numDataOutputs * 43 + 31 + 4
  const witness = 2 + numInputs * 108
  const vbytes = Math.ceil((nonWitness * 4 + witness) / 4)
  const fee = Math.ceil(Math.max(0.01, feeRate) * vbytes)
  const dustTotal = SRC20_DUST * (numDataOutputs + 1) // +1 for P2WPKH dust output
  return dustTotal + fee + serviceFeeAmount
}

/**
 * Estimate total cost for a SRC-20 bulk mint (fan-out model): one funding tx
 * splitting the wallet into `count` equal UTXOs, then `count` independent
 * single-input mint txs with no change.
 * Mirrors the bulk branch of createOrder in backend/src/src20/src20.service.ts.
 */
export function estimateSrc20BulkTotalSats(
  jsonStr: string,
  feeRate: number,
  serviceFeeAmount: number,
  count: number,
): number {
  if (count <= 1) return estimateSrc20TotalSats(jsonStr, feeRate, serviceFeeAmount)
  const rate = Math.max(0.01, feeRate)
  const rawLen = STAMP_PREFIX_LEN + new TextEncoder().encode(jsonStr).length
  const numDataOutputs = Math.ceil((2 + rawLen) / 32)
  const sfExtra = serviceFeeAmount > 0 ? 1 : 0

  // Per-mint tx: 1 input, dust + data (+ service fee) outputs, no change
  const mintNonWitness = 4 + 1 + 41 + 1 + 31 + (numDataOutputs + sfExtra) * 43 + 4
  const mintFee = Math.ceil(rate * Math.ceil((mintNonWitness * 4 + 110) / 4))
  const dustTotal = SRC20_DUST * (numDataOutputs + 1)
  const fundingValue = dustTotal + serviceFeeAmount + mintFee

  // Funding fan-out tx: 1 input (estimate), count funding outputs + change
  const fundingNonWitness = 4 + 1 + 41 + 1 + (count + 1) * 31 + 4
  const fundingFee = Math.ceil(rate * Math.ceil((fundingNonWitness * 4 + 110) / 4))

  return count * fundingValue + fundingFee
}
