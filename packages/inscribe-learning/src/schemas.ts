/**
 * Runtime schemas for the Inscribe learning contract.
 *
 * Every value that crosses a trust boundary (generated manifests, URL state,
 * local storage, imported progress files) is validated with these schemas
 * before use. Valibot 1.x, the same major used by the Inscribe application.
 */
import * as v from 'valibot'

/** Identifier shape shared by workflows, guides, steps, scenarios, outcomes. */
export const StableId = v.pipe(
  v.string(),
  v.regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, 'stable ids are lowercase slug segments'),
  v.maxLength(96),
)

export const ProtocolId = v.pipe(v.string(), v.regex(/^[a-z0-9_]+$/, 'protocol ids match inscribe protocol keys'), v.maxLength(32))

export const Slug64 = v.pipe(v.string(), v.regex(/^[a-z][a-z0-9_-]{0,63}$/))

/**
 * The three availability dimensions. They are separate on purpose: code can be
 * implemented but switched off by deployment, and enabled code can still be
 * unhealthy. No single "available" boolean exists anywhere in this contract.
 */
export const CapabilityState = v.object({
  /** The capability exists in the Inscribe codebase at the source commit. */
  implemented: v.boolean(),
  /** The current production deployment turns the capability on. */
  enabled: v.boolean(),
  /** Feature flag or contract entry that controls `enabled`, when known. */
  gatedBy: v.optional(v.string()),
  /** Identifiers of live sources whose health gates readiness, resolved at runtime. */
  healthDependencies: v.array(v.string()),
  /** True when the surface can create or move funds. Read-only views are not actionable. */
  actionable: v.boolean(),
})

export const GoalId = v.picklist([
  'inscribe_text',
  'inscribe_file',
  'batch',
  'collection',
  'deploy_token',
  'mint_token',
  'etch_rune',
  'transfer_asset',
  'recover_order',
  'learn_free',
])

export const ExperienceLevel = v.picklist(['beginner', 'intermediate', 'expert'])

export const PlannerPriority = v.picklist([
  'simplest',
  'cheapest',
  'control',
  'batch_efficiency',
  'urgency',
])

export const WalletKind = v.picklist(['universe', 'unisat', 'okx', 'xverse', 'wizz', 'manual', 'unknown'])

export const ChainId = v.picklist(['bitcoin', 'dogecoin'])
export const NetworkId = v.picklist(['mainnet', 'testnet'])

export const ContentCategory = v.picklist(['text', 'image', 'audio', 'video', 'model', 'json', 'other'])

/** One expected transaction or signing stage of a workflow. */
export const WorkflowStage = v.object({
  kind: v.picklist(['payment', 'commit', 'reveal', 'transfer', 'mint', 'deploy', 'etch', 'signature']),
  label: v.string(),
  /** Who owns the output value of this stage: the user, the miner, or the service. */
  valueOwner: v.picklist(['user', 'network_fee', 'service_fee', 'none']),
  optional: v.boolean(),
})

export const SourceRef = v.object({
  /** Repository key: 'inscribe', 'docs-platform', 'docs-inscribe'. */
  repository: v.picklist(['inscribe', 'docs-platform', 'docs-inscribe']),
  /** Exact source commit the fact was read from. */
  commit: v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/)),
  /** Path inside that repository. */
  path: v.string(),
  /** Short machine-readable note on what this source proves. */
  proves: v.string(),
})

export const Workflow = v.strictObject({
  id: StableId,
  goal: GoalId,
  title: v.string(),
  protocolId: ProtocolId,
  operation: v.picklist(['inscribe', 'deploy', 'mint', 'etch', 'transfer', 'none']),
  /** Workspace slug inside Inscribe, validated against the app route list. */
  workspace: Slug64,
  subview: v.optional(v.string()),
  chain: ChainId,
  network: NetworkId,
  state: CapabilityState,
  stages: v.array(WorkflowStage),
  /** Fee model identifier shared with the estimation primitives. */
  feeModel: v.picklist(['commit_reveal', 'direct', 'keyless_p2a', 'stamp_olga', 'src20', 'service_quote']),
  contentCategories: v.array(ContentCategory),
  batch: v.object({ supported: v.boolean(), maxItems: v.optional(v.number()) }),
  collection: v.object({ supported: v.boolean(), parent: v.boolean(), delegate: v.boolean(), gallery: v.boolean() }),
  walletRoles: v.array(v.picklist(['payment', 'ordinals', 'both', 'none'])),
  prerequisites: v.array(v.string()),
  safetyChecks: v.array(v.string()),
  guides: v.array(StableId),
  walkthroughId: v.optional(StableId),
  practiceScenarioId: v.optional(StableId),
  recoveryOutcomeId: v.optional(StableId),
  /** Safe intent fields handed to the app deep-link builder. */
  intent: v.object({
    action: v.picklist(['inscribe', 'deploy', 'mint', 'etch', 'transfer', 'resume']),
    sub: v.optional(v.string()),
    surface: v.optional(v.string()),
    destination: v.optional(v.string()),
  }),
  ranking: v.object({
    /** Higher is simpler. 0 to 100. */
    simplicity: v.number(),
    /** Relative estimated cost, 0 (cheapest) to 100. */
    cost: v.number(),
    /** Degree of user control, 0 to 100. */
    control: v.number(),
    /** Batch efficiency for multi-item goals, 0 to 100. */
    batchEfficiency: v.number(),
  }),
  sources: v.array(SourceRef),
})

export const Protocol = v.strictObject({
  id: ProtocolId,
  label: v.string(),
  chain: ChainId,
  family: v.string(),
  /** How data is carried on chain. */
  carrier: v.string(),
  operations: v.array(v.picklist(['inscribe', 'deploy', 'mint', 'etch', 'transfer'])),
  workspace: Slug64,
  state: CapabilityState,
  contentRestrictions: v.array(v.string()),
  batch: v.boolean(),
  collection: v.boolean(),
  parent: v.boolean(),
  feeModel: v.string(),
  /** Where output value goes: postage kept by the user, burned, or quoted. */
  outputValue: v.string(),
  transferModel: v.string(),
  dependencies: v.array(v.string()),
  aliases: v.array(v.pipe(v.string(), v.maxLength(48))),
  sources: v.array(SourceRef),
})

export const GuideStep = v.object({
  id: StableId,
  title: v.string(),
})

export const Guide = v.object({
  id: StableId,
  title: v.string(),
  category: v.string(),
  /** Where the full guide lives: the app Docs view or the public documentation. */
  surface: v.picklist(['app', 'public']),
  /** Public documentation route when surface is 'public'. */
  publicPath: v.optional(v.string()),
  /** Workspace the guide opens inside the app, when it has one. */
  workspace: v.optional(Slug64),
  steps: v.array(GuideStep),
  protocols: v.array(ProtocolId),
  sources: v.array(SourceRef),
})

export const Walkthrough = v.object({
  id: StableId,
  title: v.string(),
  workflowId: StableId,
  /** Public route under the documentation base path. */
  path: v.string(),
  /** App commit the captures were taken from. */
  captureCommit: v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/)),
  fixtureVersion: v.string(),
  steps: v.number(),
  practiceScenarioId: v.optional(StableId),
  lastCapturedAt: v.optional(v.string()),
  lastVerifiedAt: v.optional(v.string()),
})

export const PracticeScenario = v.object({
  id: StableId,
  title: v.string(),
  workflowId: StableId,
  path: v.string(),
  goal: GoalId,
})

export const RecoveryOutcome = v.object({
  id: StableId,
  title: v.string(),
  /** One-line diagnosis shown as the result headline. */
  diagnosis: v.string(),
  /** Can the user still act, or is the outcome irreversible? */
  reversibility: v.picklist(['recoverable', 'action_required', 'wait', 'irreversible', 'unknown']),
  /** Explicit instruction to not pay again, when applicable. */
  doNotPayAgain: v.boolean(),
  /** Workspace to open, when one applies. */
  workspace: v.optional(Slug64),
  /** Authoritative recovery guide section. */
  guideId: v.optional(StableId),
  stopConditions: v.array(v.string()),
  nextAction: v.string(),
  evidence: v.array(v.string()),
  whatNotToDo: v.array(v.string()),
  sources: v.array(SourceRef),
})

export const RecoveryQuestion = v.object({
  id: StableId,
  question: v.string(),
  options: v.array(
    v.object({
      value: v.string(),
      label: v.string(),
      next: v.string(),
    }),
  ),
})

export const RecoveryTable = v.object({
  entry: StableId,
  questions: v.array(RecoveryQuestion),
})

export const PlannerRules = v.object({
  priorityWeights: v.object({
    simplest: v.number(),
    cheapest: v.number(),
    control: v.number(),
    batch_efficiency: v.number(),
    urgency: v.number(),
  }),
  /** Penalty applied when a workflow is deployment gated but selected anyway. */
  gatedPenalty: v.number(),
  /** Penalty for workflows whose practice scenario is missing. */
  missingPracticePenalty: v.number(),
  beginnerSimplicityBias: v.number(),
  expertControlBias: v.number(),
})

export const Manifest = v.strictObject({
  schemaVersion: v.literal(1),
  generatedAt: v.pipe(v.string(), v.isoTimestamp()),
  generatorVersion: v.string(),
  sourceCommits: v.object({
    inscribe: v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/)),
    'docs-platform': v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/)),
    'docs-inscribe': v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/)),
  }),
  chain: ChainId,
  network: NetworkId,
  appOrigin: v.pipe(v.string(), v.url()),
  workflows: v.array(Workflow),
  protocols: v.array(Protocol),
  guides: v.array(Guide),
  walkthroughs: v.array(Walkthrough),
  practiceScenarios: v.array(PracticeScenario),
  recovery: v.object({
    guideId: v.string(),
    table: RecoveryTable,
    outcomes: v.array(RecoveryOutcome),
  }),
  planner: PlannerRules,
  /** Approved origins a documentation return path may point at. */
  docsReturnOrigins: v.array(v.string()),
})

export type Manifest = v.InferOutput<typeof Manifest>
export type Workflow = v.InferOutput<typeof Workflow>
export type Protocol = v.InferOutput<typeof Protocol>
export type Guide = v.InferOutput<typeof Guide>
export type GuideStep = v.InferOutput<typeof GuideStep>
export type Walkthrough = v.InferOutput<typeof Walkthrough>
export type PracticeScenario = v.InferOutput<typeof PracticeScenario>
export type RecoveryOutcome = v.InferOutput<typeof RecoveryOutcome>
export type RecoveryTable = v.InferOutput<typeof RecoveryTable>
export type CapabilityState = v.InferOutput<typeof CapabilityState>
export type SourceRef = v.InferOutput<typeof SourceRef>

/** Validated planner input. */
export const PlannerInput = v.object({
  goal: GoalId,
  protocol: v.union([ProtocolId, v.literal('help_me_choose')]),
  chain: ChainId,
  network: NetworkId,
  contentCategory: v.optional(ContentCategory),
  byteSize: v.optional(v.number()),
  itemCount: v.optional(v.number()),
  needsParent: v.optional(v.boolean()),
  needsDelegate: v.optional(v.boolean()),
  needsGallery: v.optional(v.boolean()),
  wallet: WalletKind,
  receivingAddressReady: v.boolean(),
  experience: ExperienceLevel,
  priority: PlannerPriority,
  practiceFirst: v.boolean(),
})
export type PlannerInput = v.InferOutput<typeof PlannerInput>

export const ExclusionReasonSchema = v.object({
  code: v.picklist([
    'unsupported_operation',
    'not_implemented',
    'deployment_gated',
    'read_only',
    'protocol_mismatch',
    'content_mismatch',
    'capacity_mismatch',
    'collection_mismatch',
    'wallet_mismatch',
    'receiving_not_ready',
  ]),
  detail: v.string(),
})

export type ExclusionReason = v.InferOutput<typeof ExclusionReasonSchema>

export interface PlanCandidate {
  workflow: Workflow
  score: number
  /** Which ranking rule produced the score, so "why this one" always has an answer. */
  scoreBreakdown: Array<{ rule: string; value: number }>
}

export interface PlannerResult {
  input: PlannerInput
  recommended: PlanCandidate | null
  alternatives: PlanCandidate[]
  excluded: Array<{ workflow: Workflow; reason: ExclusionReason }>
  /** True when live status was consulted and could not be reached. */
  liveStatusUnknown: boolean
  generatedAt: string
}

export const DeepLinkIntent = v.object({
  workspace: Slug64,
  sub: v.optional(v.string()),
  action: v.optional(v.picklist(['inscribe', 'deploy', 'mint', 'etch', 'transfer', 'resume'])),
  protocol: v.optional(ProtocolId),
  ticker: v.optional(Slug64),
  destination: v.optional(v.picklist(['ordinals', 'drops', 'op_return', 'stamps'])),
  surface: v.optional(v.picklist(['ordinals', 'drops'])),
  network: v.optional(NetworkId),
  guide: v.optional(StableId),
  step: v.optional(StableId),
  scenario: v.optional(StableId),
  experience: v.optional(v.picklist(['guided', 'developer'])),
  /** Documentation return path, origin checked against the approved list. */
  docsReturn: v.optional(v.pipe(v.string(), v.maxLength(512))),
})
export type DeepLinkIntent = v.InferOutput<typeof DeepLinkIntent>

/** Version 2 guide progress keyed by stable step IDs. */
export const ProgressV2 = v.strictObject({
  version: v.literal(2),
  guides: v.record(
    StableId,
    v.object({
      steps: v.array(StableId),
      done: v.boolean(),
      at: v.number(),
    }),
  ),
})
export type ProgressV2 = v.InferOutput<typeof ProgressV2>

/** Version 1 progress, index based, kept only for migration. */
export const ProgressV1 = v.object({
  version: v.optional(v.literal(1)),
  guides: v.record(
    v.string(),
    v.object({
      steps: v.array(v.number()),
      done: v.boolean(),
      at: v.number(),
    }),
  ),
})
export type ProgressV1 = v.InferOutput<typeof ProgressV1>

export function parseManifest(value: unknown): Manifest {
  return v.parse(Manifest, value)
}

export function tryParseManifest(value: unknown): { ok: true; manifest: Manifest } | { ok: false; issues: string } {
  const result = v.safeParse(Manifest, value)
  if (result.success) return { ok: true, manifest: result.output }
  const head = result.issues
    .slice(0, 5)
    .map((issue) => `${issue.path?.map((p) => p.key).join('.') ?? 'root'}: ${issue.message}`)
    .join('; ')
  return { ok: false, issues: head }
}
