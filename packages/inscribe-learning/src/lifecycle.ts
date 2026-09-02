/**
 * Lifecycle helpers. The contract keeps implemented, enabled, and healthy as
 * three separate dimensions. Health is never stored here: it is resolved at
 * runtime from the live sources named in `healthDependencies`, and an
 * unreachable source resolves to `unknown`, never to healthy and never to a
 * blank value.
 */
import type { CapabilityState } from './schemas.ts'

export type ReadinessState = 'ready' | 'gated' | 'incomplete' | 'read_only' | 'unknown'

export type HealthState = 'healthy' | 'degraded' | 'stale' | 'unavailable' | 'disabled' | 'unknown'

export function readinessOf(state: CapabilityState): ReadinessState {
  if (!state.implemented) return 'incomplete'
  if (!state.actionable) return 'read_only'
  if (!state.enabled) return 'gated'
  return 'ready'
}

export function resolveHealth(
  statuses: Record<string, HealthState | undefined>,
  dependencies: readonly string[],
): HealthState {
  if (dependencies.length === 0) return 'healthy'
  const resolved = dependencies.map((id) => statuses[id] ?? 'unknown')
  if (resolved.includes('disabled')) return 'disabled'
  if (resolved.includes('unavailable')) return 'unavailable'
  if (resolved.includes('unknown')) return 'unknown'
  if (resolved.includes('stale')) return 'stale'
  if (resolved.includes('degraded')) return 'degraded'
  return 'healthy'
}

/** Short user-facing label pairs for the states. Never collapse the dimensions. */
export const READINESS_LABEL: Record<ReadinessState, string> = {
  ready: 'Released',
  gated: 'Deployment controlled',
  incomplete: 'Not complete',
  read_only: 'Read only',
  unknown: 'State unknown',
}

export const HEALTH_LABEL: Record<HealthState, string> = {
  healthy: 'Sources healthy now',
  degraded: 'Sources degraded',
  stale: 'Sources stale',
  unavailable: 'Sources unavailable',
  disabled: 'Disabled by policy',
  unknown: 'Live state unknown',
}
