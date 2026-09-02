/**
 * Recovery navigator state machine. A decision table walks a reader from their
 * situation to a terminal outcome. Build-time helpers detect unreachable nodes
 * and loops so the table cannot silently ship a dead branch.
 */
import type { Manifest, RecoveryTable } from './schemas.ts'

export interface RecoveryPath {
  outcomeId: string
  answers: Array<{ questionId: string; value: string }>
}

/** Outcome nodes are stored as "outcome:<id>"; the walker returns the bare id. */
function bareOutcomeId(nodeId: string): string {
  return nodeId.startsWith('outcome:') ? nodeId.slice('outcome:'.length) : nodeId
}

export function walkRecoveryTable(table: RecoveryTable, answers: Record<string, string>): RecoveryPath {
  const trail: RecoveryPath['answers'] = []
  let nodeId = table.entry
  const visited = new Set<string>([nodeId])

  for (let hop = 0; hop < 64; hop += 1) {
    const question = table.questions.find((q) => q.id === nodeId)
    if (!question) {
      return { outcomeId: bareOutcomeId(nodeId), answers: trail }
    }
    const answer = answers[question.id]
    const option = question.options.find((o) => o.value === answer) ?? question.options[0]
    if (!option) {
      return { outcomeId: 'recovery-unknown', answers: trail }
    }
    trail.push({ questionId: question.id, value: option.value })
    nodeId = option.next
    if (visited.has(nodeId)) {
      // A loop can only exist as a build-time defect; walking defensively
      // terminates into the unknown outcome instead of hanging.
      return { outcomeId: 'recovery-unknown', answers: trail }
    }
    visited.add(nodeId)
  }
  return { outcomeId: 'recovery-unknown', answers: trail }
}

export interface TableAudit {
  unreachable: string[]
  loops: Array<{ from: string; to: string }>
  missingOutcomes: string[]
  deadEnds: string[]
}

/**
 * Audit the table: every question must be reachable from the entry, every
 * non-outcome `next` must name an existing question, and every outcome id the
 * table can emit must exist in the manifest outcome list.
 */
export function auditRecoveryTable(table: RecoveryTable, outcomeIds: readonly string[]): TableAudit {
  const questionIds = new Set(table.questions.map((q) => q.id))
  const outcomeSet = new Set(outcomeIds)
  const reachable = new Set<string>()
  const loops: TableAudit['loops'] = []
  const missingOutcomes = new Set<string>()
  const deadEnds: string[] = []

  const walk = (nodeId: string, path: string[]) => {
    if (path.includes(nodeId)) {
      loops.push({ from: path[path.length - 1] ?? nodeId, to: nodeId })
      return
    }
    if (reachable.has(nodeId)) return
    reachable.add(nodeId)
    const question = table.questions.find((q) => q.id === nodeId)
    if (!question) {
      if (!outcomeSet.has(nodeId)) missingOutcomes.add(nodeId)
      return
    }
    if (question.options.length === 0) deadEnds.push(nodeId)
    for (const option of question.options) {
      walk(option.next, [...path, nodeId])
    }
  }
  walk(table.entry, [])

  const unreachable = table.questions.map((q) => q.id).filter((id) => !reachable.has(id))
  return { unreachable, loops, missingOutcomes: [...missingOutcomes], deadEnds }
}

/** Every outcome the table can reach must exist in the manifest. */
export function reachableOutcomeIds(table: RecoveryTable): string[] {
  const ids = new Set<string>()
  const questionIds = new Set(table.questions.map((q) => q.id))
  for (const q of table.questions) {
    for (const option of q.options) {
      if (!questionIds.has(option.next)) ids.add(option.next)
    }
  }
  return [...ids]
}

export function recoveryOutcome(manifest: Manifest, outcomeId: string) {
  return manifest.recovery.outcomes.find((o) => o.id === outcomeId) ?? null
}
