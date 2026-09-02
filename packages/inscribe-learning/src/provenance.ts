/**
 * Provenance helpers. Every material surface carries where its facts came
 * from, the exact source commits, and when it was last verified.
 */
import type { SourceRef } from './schemas.ts'

export interface ProvenanceBlock {
  sources: SourceRef[]
  lastVerified: string
  /** Route of the owning documentation page. */
  owningRoute: string
}

export function provenanceFooter(block: ProvenanceBlock): string {
  const commits = [...new Set(block.sources.map((s) => `${s.repository}@${s.commit.slice(0, 12)}`))]
  return `${block.owningRoute} verified ${block.lastVerified.slice(0, 10)} from ${commits.join(', ')}`
}

export function mergeSources(...groups: SourceRef[][]): SourceRef[] {
  const seen = new Map<string, SourceRef>()
  for (const group of groups) {
    for (const ref of group) {
      const key = `${ref.repository}:${ref.path}:${ref.proves}`
      if (!seen.has(key)) seen.set(key, ref)
    }
  }
  return [...seen.values()]
}

export function newestCommitOf(refs: readonly SourceRef[]): string | null {
  const commits = refs.map((r) => r.commit)
  return commits.length > 0 ? commits[0] : null
}
