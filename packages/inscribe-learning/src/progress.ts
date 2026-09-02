/**
 * Learning progress: version 2 keyed by stable step IDs, migration from the
 * version 1 index-based shape, lossless merge, and the Learning Passport
 * export/import format. The passport carries only guide IDs, step IDs,
 * completion state, and timestamps: no wallet data, addresses, orders, or
 * identifiers of any kind.
 */
import * as v from 'valibot'
import { ProgressV1, ProgressV2 } from './schemas.ts'
import type { ProgressV2 as ProgressV2Type } from './schemas.ts'
import type { Manifest } from './schemas.ts'

export interface MigrationResult {
  progress: ProgressV2Type
  /** Index-based entries that could not be matched to a current step title. */
  dropped: Array<{ guideId: string; index: number }>
}

/**
 * Migrate v1 progress against the manifest. V1 stored step indexes for the
 * guide version they belonged to; indexes map onto the manifest's stable step
 * IDs in order. Indexes beyond the current step count are reported as dropped,
 * never silently discarded.
 */
export function migrateV1(v1: unknown, manifest: Manifest): MigrationResult {
  const parsed = v.parse(ProgressV1, v1)
  const progress: ProgressV2Type = { version: 2, guides: {} }
  const dropped: MigrationResult['dropped'] = []

  for (const [guideId, entry] of Object.entries(parsed.guides)) {
    const guide = manifest.guides.find((g) => g.id === guideId)
    if (!guide) {
      entry.steps.forEach((index) => dropped.push({ guideId, index }))
      continue
    }
    const steps: string[] = []
    for (const index of entry.steps) {
      const step = guide.steps[index]
      if (step) steps.push(step.id)
      else dropped.push({ guideId, index })
    }
    if (steps.length > 0 || entry.done) {
      progress.guides[guideId] = { steps: [...new Set(steps)], done: entry.done, at: entry.at }
    }
  }
  return { progress, dropped }
}

/** Merge two progress states. Later timestamps win per step; unions merge. */
export function mergeProgress(a: ProgressV2Type, b: ProgressV2Type): ProgressV2Type {
  const out: ProgressV2Type = { version: 2, guides: {} }
  const ids = new Set([...Object.keys(a.guides), ...Object.keys(b.guides)])
  for (const guideId of ids) {
    const ga = a.guides[guideId]
    const gb = b.guides[guideId]
    if (!ga) { out.guides[guideId] = gb; continue }
    if (!gb) { out.guides[guideId] = ga; continue }
    const stepSet = new Map<string, number>()
    for (const step of ga.steps) stepSet.set(step, ga.at)
    for (const step of gb.steps) stepSet.set(step, Math.max(gb.at, stepSet.get(step) ?? 0))
    out.guides[guideId] = {
      steps: [...stepSet.keys()],
      done: ga.done || gb.done,
      at: Math.max(ga.at, gb.at),
    }
  }
  return out
}

export function parseProgressV2(value: unknown): ProgressV2Type {
  return v.parse(ProgressV2, value)
}

/**
 * Learning Passport: compact URL-safe text with a checksum. The format is
 * versioned so future schemas can replace it without silent corruption.
 */
export interface Passport {
  version: 2
  exportedAt: string
  progress: ProgressV2Type
}

export function exportPassport(progress: ProgressV2Type, exportedAt?: string): string {
  const passport: Passport = { version: 2, exportedAt: exportedAt ?? new Date().toISOString(), progress }
  const json = JSON.stringify(passport)
  const body = base64UrlEncode(json)
  const sum = checksum(body)
  return `UBP2-${sum}-${body}`
}

export function importPassport(text: string): Passport {
  const trimmed = text.trim()
  const match = /^UBP2-([0-9A-Fa-f]{8})-(.+)$/.exec(trimmed)
  if (!match) throw new Error('This is not a Universe Learning Passport file.')
  const [, sum, body] = match
  if (checksum(body) !== sum.toLowerCase()) throw new Error('Passport checksum mismatch: the text was altered.')
  let parsed: unknown
  try {
    parsed = JSON.parse(base64UrlDecode(body))
  } catch {
    throw new Error('Passport content is not valid JSON.')
  }
  const passport = v.parse(
    v.object({ version: v.literal(2), exportedAt: v.pipe(v.string(), v.isoTimestamp()), progress: ProgressV2 }),
    parsed,
  )
  return passport
}

function checksum(input: string): string {
  // FNV-1a 32-bit: deterministic in every runtime, no crypto dependency, and
  // only asked to catch copy/paste damage, not adversarial edits.
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
