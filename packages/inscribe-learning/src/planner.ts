/**
 * Guided action planner: a deterministic, explainable decision engine.
 * Every accepted or rejected workflow carries its reason. Ranking weights come
 * from the manifest so the rule that selected a result is always displayable.
 */
import type {
  ExclusionReason,
  Manifest,
  PlannerInput,
  PlannerResult,
  PlanCandidate,
  Workflow,
} from './schemas.ts'
import { readinessOf } from './lifecycle.ts'

/**
 * The "cost" ranking field is relative expense: lower is cheaper. Priority
 * weights come from the manifest and are normalized in the score breakdown.
 */
export function planGoal(manifest: Manifest, input: PlannerInput, now?: string): PlannerResult {
  const weights = manifest.planner.priorityWeights
  const priorityWeight = weights[input.priority]
  const excluded: PlannerResult['excluded'] = []
  const accepted: PlanCandidate[] = []

  for (const workflow of manifest.workflows) {
    const reason = excludeReasonFor(manifest, input, workflow)
    if (reason) {
      excluded.push({ workflow, reason })
      continue
    }
    const breakdown: PlanCandidate['scoreBreakdown'] = []
    let score = 0

    const goalMatch = workflow.goal === input.goal ? 40 : 0
    breakdown.push({ rule: 'goal match', value: goalMatch })
    score += goalMatch

    const protocolMatch = input.protocol === 'help_me_choose' || workflow.protocolId === input.protocol ? 15 : 0
    breakdown.push({ rule: 'protocol match', value: protocolMatch })
    score += protocolMatch

    const simplicity = (workflow.ranking.simplicity / 100) * priorityWeight
    breakdown.push({ rule: `priority ${input.priority}`, value: round1(simplicity) })
    score += simplicity

    if (input.priority === 'cheapest') {
      const cheap = ((100 - workflow.ranking.cost) / 100) * 15
      breakdown.push({ rule: 'low relative cost', value: round1(cheap) })
      score += cheap
    }
    if (input.priority === 'control') {
      const control = (workflow.ranking.control / 100) * 15
      breakdown.push({ rule: 'user control', value: round1(control) })
      score += control
    }
    if (input.priority === 'batch_efficiency' && (input.itemCount ?? 1) > 1) {
      const batch = (workflow.ranking.batchEfficiency / 100) * 20
      breakdown.push({ rule: 'batch efficiency', value: round1(batch) })
      score += batch
    }
    if (input.experience === 'beginner') {
      const bias = (workflow.ranking.simplicity / 100) * manifest.planner.beginnerSimplicityBias
      breakdown.push({ rule: 'beginner simplicity bias', value: round1(bias) })
      score += bias
    }
    if (input.experience === 'expert') {
      const bias = (workflow.ranking.control / 100) * manifest.planner.expertControlBias
      breakdown.push({ rule: 'expert control bias', value: round1(bias) })
      score += bias
    }
    if (input.practiceFirst && !workflow.practiceScenarioId) {
      const penalty = manifest.planner.missingPracticePenalty
      breakdown.push({ rule: 'no practice scenario', value: -penalty })
      score -= penalty
    }
    if (!input.receivingAddressReady) {
      // Not an exclusion: the plan stays valid and lists address setup as the
      // first prerequisite. It only lowers confidence in acting immediately.
      const penalty = 5
      breakdown.push({ rule: 'receiving address not confirmed', value: -penalty })
      score -= penalty
    }

    accepted.push({ workflow, score: round1(score), scoreBreakdown: breakdown })
  }

  accepted.sort((a, b) => b.score - a.score || a.workflow.id.localeCompare(b.workflow.id))

  const recommended = accepted[0] ?? null
  const alternatives = accepted.slice(1, 4)

  return {
    input,
    recommended,
    alternatives,
    excluded,
    liveStatusUnknown: false,
    generatedAt: now ?? new Date().toISOString(),
  }
}

function excludeReasonFor(
  manifest: Manifest,
  input: PlannerInput,
  workflow: Workflow,
): ExclusionReason | null {
  if (!workflow.state.implemented) {
    return { code: 'not_implemented', detail: `${workflow.id} is not complete in the app source, so it cannot be planned yet.` }
  }
  if (!workflow.state.actionable && workflow.goal !== 'learn_free') {
    return { code: 'read_only', detail: `${workflow.id} is a read-only view. Nothing here can create or move assets.` }
  }
  if (!workflow.state.enabled) {
    return { code: 'deployment_gated', detail: `Enabled by deployment: ${workflow.state.gatedBy ?? 'deployment contract'}. The workspace exists in code but the current release keeps it off.` }
  }
  if (workflow.goal !== input.goal) {
    return { code: 'unsupported_operation', detail: `Workflow goal ${workflow.goal} does not match the requested goal ${input.goal}.` }
  }
  if (input.protocol !== 'help_me_choose' && workflow.protocolId !== input.protocol) {
    return { code: 'protocol_mismatch', detail: `Workflow targets ${workflow.protocolId}, not the requested ${input.protocol}.` }
  }
  if (workflow.chain !== input.chain || workflow.network !== input.network) {
    return { code: 'protocol_mismatch', detail: `Workflow runs on ${workflow.chain} ${workflow.network}.` }
  }
  if (
    input.contentCategory &&
    workflow.contentCategories.length > 0 &&
    !workflow.contentCategories.includes(input.contentCategory)
  ) {
    return { code: 'content_mismatch', detail: `Workflow does not accept ${input.contentCategory} content.` }
  }
  if (
    input.byteSize != null &&
    workflow.contentCategories.length > 0 &&
    workflow.contentCategories.includes('text') === false &&
    input.goal === 'inscribe_text'
  ) {
    return { code: 'content_mismatch', detail: 'Text goals need a workflow that accepts text content.' }
  }
  if ((input.itemCount ?? 1) > 1 && !workflow.batch.supported && (input.itemCount ?? 1) > 1) {
    return { code: 'capacity_mismatch', detail: `Workflow handles one item at a time; ${input.itemCount} items were requested.` }
  }
  if (workflow.batch.maxItems != null && (input.itemCount ?? 1) > workflow.batch.maxItems) {
    return { code: 'capacity_mismatch', detail: `Workflow supports at most ${workflow.batch.maxItems} items per batch.` }
  }
  if (
    (input.needsParent && !workflow.collection.parent) ||
    (input.needsDelegate && !workflow.collection.delegate) ||
    (input.needsGallery && !workflow.collection.gallery)
  ) {
    const missing = [
      input.needsParent && !workflow.collection.parent ? 'parent' : null,
      input.needsDelegate && !workflow.collection.delegate ? 'delegate' : null,
      input.needsGallery && !workflow.collection.gallery ? 'gallery' : null,
    ].filter(Boolean)
    return { code: 'collection_mismatch', detail: `Workflow does not support: ${missing.join(', ')}.` }
  }
  if (input.goal === 'collection' && !workflow.collection.supported) {
    return { code: 'collection_mismatch', detail: 'Workflow does not manage collections.' }
  }
  return null
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
