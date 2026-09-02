/**
 * Protocol decision and comparison logic. Deterministic: matches, partial
 * matches, and exclusions all carry reasons, and cells the sources do not
 * establish render as unestablished rather than being invented.
 */
import type { Manifest, Protocol } from './schemas.ts'
import { readinessOf, type ReadinessState } from './lifecycle.ts'

export interface ProtocolFilters {
  operations?: string[]
  chain?: string
  readiness?: ReadinessState[]
  health?: string[]
  contentCategory?: string
  batch?: boolean
  collection?: boolean
  parent?: boolean
  walletRoles?: string[]
}

export interface ProtocolMatch {
  protocol: Protocol
  matched: string[]
  unmet: string[]
  score: number
}

export interface ProtocolSelectionResult {
  matches: ProtocolMatch[]
  partial: ProtocolMatch[]
  excluded: Array<{ protocol: Protocol; reason: string }>
}

export function selectProtocols(manifest: Manifest, filters: ProtocolFilters): ProtocolSelectionResult {
  const matches: ProtocolMatch[] = []
  const partial: ProtocolMatch[] = []
  const excluded: ProtocolSelectionResult['excluded'] = []

  for (const protocol of manifest.protocols) {
    const matched: string[] = []
    const unmet: string[] = []
    let hardFail: string | null = null

    if (filters.chain && protocol.chain !== filters.chain) {
      hardFail = `Runs on ${protocol.chain}, not ${filters.chain}.`
    }
    if (!hardFail && filters.operations && filters.operations.length > 0) {
      const missing = filters.operations.filter((op) => !protocol.operations.includes(op as never))
      if (missing.length === filters.operations.length) {
        hardFail = `Supports ${protocol.operations.join(', ')}; none of ${filters.operations.join(', ')} are implemented for it.`
      } else if (missing.length > 0) {
        unmet.push(`Not supported here: ${missing.join(', ')}.`)
      } else {
        matched.push(`Supports ${filters.operations.join(', ')}.`)
      }
    }
    if (!hardFail && filters.readiness && filters.readiness.length > 0) {
      const readiness = readinessOf(protocol.state)
      if (!filters.readiness.includes(readiness)) {
        hardFail = `State is ${readiness}, outside the requested filter.`
      } else {
        matched.push(`State: ${readiness}.`)
      }
    }
    if (!hardFail && filters.batch === true && !protocol.batch) {
      hardFail = 'No batch support.'
    }
    if (!hardFail && filters.collection === true && !protocol.collection) {
      hardFail = 'No collection support.'
    }
    if (!hardFail && filters.parent === true && !protocol.parent) {
      hardFail = 'No parent inscription support.'
    }

    if (hardFail) {
      excluded.push({ protocol, reason: hardFail })
      continue
    }
    const score = matched.length * 2 - unmet.length
    const entry: ProtocolMatch = { protocol, matched, unmet, score }
    ;(unmet.length === 0 ? matches : partial).push(entry)
  }

  matches.sort((a, b) => b.score - a.score || a.protocol.id.localeCompare(b.protocol.id))
  partial.sort((a, b) => b.score - a.score || a.protocol.id.localeCompare(b.protocol.id))
  return { matches, partial, excluded }
}

/** Comparison rows are rendered only when a source backs the value. */
export interface ComparisonCell {
  dimension: string
  value: string | null
}

const DIMENSIONS: Array<{ label: string; pick: (p: Protocol) => string | null }> = [
  { label: 'Protocol', pick: (p) => `${p.label} (${p.id})` },
  { label: 'Family', pick: (p) => p.family },
  { label: 'Chain', pick: (p) => p.chain },
  { label: 'Carrier', pick: (p) => p.carrier },
  { label: 'Creation operations', pick: (p) => p.operations.join(', ') },
  {
    label: 'Release state',
    pick: (p) => {
      const r = readinessOf(p.state)
      return r === 'ready' ? 'Released' : r === 'gated' ? 'Deployment controlled' : r === 'read_only' ? 'Read only' : 'Not complete'
    },
  },
  { label: 'Workspace', pick: (p) => `/${p.workspace.replace(/_/g, '-')}` },
  { label: 'Content restrictions', pick: (p) => (p.contentRestrictions.length ? p.contentRestrictions.join('; ') : null) },
  { label: 'Batch behavior', pick: (p) => (p.batch ? 'Batch supported' : 'One item at a time') },
  { label: 'Collections and parents', pick: (p) => (p.collection || p.parent ? 'Supported' : 'Not supported') },
  { label: 'Fee model', pick: (p) => p.feeModel },
  { label: 'Output value', pick: (p) => p.outputValue },
  { label: 'Transfer model', pick: (p) => p.transferModel },
  { label: 'Data dependencies', pick: (p) => (p.dependencies.length ? p.dependencies.join(', ') : null) },
]

export function comparisonRows(manifest: Manifest, protocolIds: string[]): Array<{ protocol: Protocol; cells: ComparisonCell[] }> {
  const picked = protocolIds
    .map((id) => manifest.protocols.find((p) => p.id === id))
    .filter((p): p is Protocol => Boolean(p))
  return picked.map((protocol) => ({
    protocol,
    cells: DIMENSIONS.map((d) => ({ dimension: d.label, value: d.pick(protocol) })),
  }))
}

export const COMPARISON_DIMENSIONS: readonly string[] = DIMENSIONS.map((d) => d.label)
