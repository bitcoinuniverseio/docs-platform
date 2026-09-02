/** Stable identity helpers shared by the docs site and the application. */

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'step'
}

/**
 * Stable step ID. Explicit step IDs win; otherwise the slug of the step title
 * at manifest generation time, prefixed by the guide id with an underscore
 * separator. Both surfaces resolve steps through the manifest, so reordering
 * steps never shifts progress onto the wrong entry.
 */
export function stepId(guideId: string, index: number, title: string, explicit?: string): string {
  if (explicit) return explicit
  return `${guideId}_${slugify(title) || index}`
}

export function workflowId(protocolId: string, operation: string, goal: string): string {
  return `wf-${protocolId.replace(/_/g, '-')}-${operation}-${slugify(goal)}`
}

export function walkthroughId(protocolId: string, operation: string): string {
  return `vw-${protocolId.replace(/_/g, '-')}-${operation}`
}

export function practiceScenarioId(protocolId: string, operation: string): string {
  return `ps-${protocolId.replace(/_/g, '-')}-${operation}`
}
