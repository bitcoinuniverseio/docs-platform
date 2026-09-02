#!/usr/bin/env node
/**
 * Generate the Inscribe learning manifest from authoritative sources.
 *
 * Sources, in priority order:
 *   inscribe       creation action matrix, protocol tabs, workspace routes,
 *                  deployment contract, in-app guide content, estimator commit
 *   docs-platform  capability snapshot and protocol registry narrative
 *   docs-inscribe  public protocol facts, recovery decision table, learning
 *                  config, walkthrough and practice scenario registries
 *
 * The generator proves every cross reference before it writes: workspaces
 * exist in the app route list, walkthrough and scenario ids resolve, recovery
 * outcomes reference real guides, the recovery table has no loops or
 * unreachable nodes, every actionable workflow resolves to a planner path,
 * and every workflow intent round-trips through the safe link builder.
 *
 * Output is byte-deterministic for identical inputs: pass --generated-at to
 * pin the timestamp.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { cpSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { auditRecoveryTable, reachableOutcomeIds } from '../src/recovery.ts'
import { buildInscribeLink } from '../src/deep-links.ts'
import { planGoal } from '../src/planner.ts'
import { parseManifest } from '../src/schemas.ts'
import { stepId } from '../src/ids.ts'

const GENERATOR_VERSION = '1.0.0'

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : null
}

function need(name) {
  const value = arg(name)
  if (!value) {
    console.error(`generate-learning-manifest: --${name} is required`)
    process.exit(1)
  }
  return resolve(value)
}

const inscribePath = need('inscribe')
const platformPath = need('docs-platform')
const docsPath = need('docs-inscribe')
const outPath = arg('out') ? resolve(arg('out')) : join(docsPath, 'data', 'inscribe-learning.manifest.json')
const generatedAt = arg('generated-at') ?? new Date().toISOString()

function gitCommit(repoPath, override) {
  if (override) return override
  return execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

const commits = {
  inscribe: gitCommit(inscribePath, arg('inscribe-commit')),
  'docs-platform': gitCommit(platformPath, arg('docs-platform-commit')),
  'docs-inscribe': gitCommit(docsPath, arg('docs-inscribe-commit')),
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readText(path) {
  return readFileSync(path, 'utf8')
}

// ---------------------------------------------------------------------------
// App facts
// ---------------------------------------------------------------------------

function extractConstArray(source, name) {
  const match = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`).exec(source)
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

function extractFrozenRecord(source, name) {
  const match = new RegExp(`const ${name}[^=]*= Object\\.freeze\\(\\{([\\s\\S]*?)\\n\\}\\)`).exec(source)
  if (!match) throw new Error(`cannot extract ${name}`)
  const record = {}
  for (const m of match[1].matchAll(/([A-Za-z0-9_]+):\s*\[([^\]]*)\]/g)) {
    record[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1])
  }
  for (const m of match[1].matchAll(/([A-Za-z0-9_]+):\s*'([^']+)'/g)) {
    record[m[1]] = m[2]
  }
  return record
}

const inscribeFrontend = join(inscribePath, 'frontend')
const dashboardRoutesSrc = readText(join(inscribeFrontend, 'src/utils/dashboardRoutes.ts'))
const intentSrc = readText(join(inscribeFrontend, 'src/utils/ecosystemInboundIntent.ts'))

const VALID_MAIN_TABS = extractConstArray(dashboardRoutesSrc, 'VALID_MAIN_TABS')
const workspaceSlugs = new Set(VALID_MAIN_TABS.map((t) => t.replace(/_/g, '-')))
const SUPPORTED_CREATION_ACTIONS = extractFrozenRecord(intentSrc, 'SUPPORTED_CREATION_ACTIONS')
const PROTOCOL_TABS = extractFrozenRecord(intentSrc, 'PROTOCOL_TABS')

const contract = readJson(join(inscribePath, 'backend/data/production-protocol-contract.json'))
const runtimeCapabilities = contract.runtimeCapabilities ?? {}

function deploymentFor(protocolId) {
  const capability = runtimeCapabilities[protocolId]
  if (!capability) return { enabled: true, gatedBy: null, smokeProbe: null }
  return {
    enabled: capability.enabled !== false,
    gatedBy: capability.frontendFlag ?? null,
    smokeProbe: capability.smokeProbe ?? null,
  }
}

// In-app guides: copy content to a temp dir, rewrite extensionless imports so
// Node type stripping can load the exact production guide content.
function loadAppGuides() {
  const contentDir = join(inscribeFrontend, 'src/features/docs/content')
  const tmp = mkdtempSync(join(tmpdir(), 'inscribe-guides-'))
  try {
    const typesSrc = readText(join(inscribeFrontend, 'src/features/docs/types.ts'))
    writeFileSync(join(tmp, 'types.ts'), typesSrc.replace(/from '\.\.\//g, "from './"))
    for (const file of readdirSync(contentDir)) {
      if (!file.endsWith('.ts')) continue
      let src = readText(join(contentDir, file))
      src = src.replace(/from '\.\/types'/g, "from './types.ts'")
      src = src.replace(/from '\.\.\/types'/g, "from './types.ts'")
      src = src.replace(/from '\.\/([a-z]+)'/g, "from './$1.ts'")
      writeFileSync(join(tmp, file), src)
    }
    return import(pathToFileURL(join(tmp, 'index.ts')).href).then((m) => m.DOC_GUIDES)
  } finally {
    setTimeout(() => rmSync(tmp, { recursive: true, force: true }), 5000)
  }
}

const PROTOCOL_FROM_TITLE = [
  [/\bbrc-?20\b/i, 'brc20'],
  [/\bsrc-?20\b/i, 'src20'],
  [/\bsrc-?101\b/i, 'src101'],
  [/\brunes?\b/i, 'runes'],
  [/\bmezcal\b/i, 'mezcal'],
  [/\balkanes?\b/i, 'alkanes'],
  [/\bcat-?20\b/i, 'cat20'],
  [/\batomicals?\b/i, 'atomicals'],
  [/\barc-?20\b/i, 'arc20'],
  [/\btap\b/i, 'tap'],
  [/\bdrop pacts?\b|\bdrops?\b/i, 'drops'],
  [/\bop[_ ]?drop\b/i, 'op_drop'],
  [/\bblock-?20\b/i, 'block20'],
  [/\bstamps?\b/i, 'stamps'],
  [/\bdust-?20\b/i, 'dust20'],
  [/\bop[_ ]?return\b/i, 'op_return'],
  [/\bordinals?\b|inscription/i, 'ordinals'],
]

function protocolsForGuide(guide) {
  const found = new Set()
  const haystack = `${guide.title} ${guide.summary ?? ''}`
  for (const [pattern, id] of PROTOCOL_FROM_TITLE) {
    if (pattern.test(haystack)) found.add(id)
  }
  return [...found]
}

function workspaceOfGuide(guide) {
  const tabs = new Set()
  const collect = (step) => {
    if (step?.link?.tab) tabs.add(step.link.tab)
    for (const link of step?.links ?? []) if (link?.tab) tabs.add(link.tab)
  }
  if (guide.open?.tab) tabs.add(guide.open.tab)
  for (const step of guide.steps) collect(step)
  const first = [...tabs][0]
  return first ? first.replace(/_/g, '-') : undefined
}

// ---------------------------------------------------------------------------
// Platform facts
// ---------------------------------------------------------------------------

const snapshot = readJson(join(platformPath, 'packages/ecosystem-registry/data/capability-snapshot.json'))
const registry = readJson(join(platformPath, 'packages/ecosystem-registry/data/protocols.json'))
const registryList = Array.isArray(registry.protocols) ? registry.protocols : Object.values(registry)

function registryFor(id) {
  return registryList.find((p) => p.id === id || p.capabilityId === id) ?? null
}

function snapshotFor(id) {
  return snapshot.protocols?.[id] ?? null
}

// ---------------------------------------------------------------------------
// Public documentation facts
// ---------------------------------------------------------------------------

const learningConfig = readJson(join(docsPath, 'data/learning-config.json'))
const protocolFacts = readJson(join(docsPath, 'data/protocol-facts.json')).facts
const recoveryTable = readJson(join(docsPath, 'data/recovery-decision-table.json'))
const walkthroughRegistry = readJson(join(docsPath, 'data/walkthroughs.json'))
const scenarioRegistry = readJson(join(docsPath, 'data/practice-scenarios.json'))

const docSource = (path, proves) => ({
  repository: 'docs-inscribe',
  commit: commits['docs-inscribe'],
  path,
  proves,
})
const appSource = (path, proves) => ({ repository: 'inscribe', commit: commits.inscribe, path, proves })
const platformSource = (path, proves) => ({
  repository: 'docs-platform',
  commit: commits['docs-platform'],
  path,
  proves,
})

// ---------------------------------------------------------------------------
// Protocols
// ---------------------------------------------------------------------------

const creationProtocolIds = Object.keys(SUPPORTED_CREATION_ACTIONS)
const readOnlyProtocolIds = Object.keys(PROTOCOL_TABS).filter((id) => !creationProtocolIds.includes(id))

function buildProtocol(id) {
  const facts = protocolFacts[id] ?? null
  const snap = snapshotFor(id)
  const reg = registryFor(id)
  const deployment = deploymentFor(id)
  const operations = SUPPORTED_CREATION_ACTIONS[id] ?? []
  const workspace = (PROTOCOL_TABS[id] ?? 'inscribe').replace(/_/g, '-')

  if (!facts && operations.length > 0) {
    throw new Error(`protocol ${id} has creation actions but no docs-inscribe protocol facts`)
  }
  if (!workspaceSlugs.has(workspace)) {
    throw new Error(`protocol ${id} maps to unknown workspace ${workspace}`)
  }

  const actionable = operations.length > 0 && deployment.enabled
  const chain = snap?.chain ?? reg?.chain ?? null
  if (chain !== 'bitcoin' && chain !== 'dogecoin') {
    throw new Error(`protocol ${id}: chain ${chain} is not established as bitcoin or dogecoin`)
  }
  return {
    id,
    label: snap?.displayName ?? reg?.name ?? id,
    chain,
    family: reg?.family ?? 'inscription',
    carrier: reg?.carrier ?? 'Not established by an authoritative source',
    operations,
    workspace,
    state: {
      implemented: true,
      enabled: deployment.enabled,
      ...(deployment.gatedBy ? { gatedBy: deployment.gatedBy } : {}),
      healthDependencies: facts?.dependencies ?? [],
      actionable,
    },
    contentRestrictions: facts?.contentRestrictions ?? [],
    batch: facts?.batch ?? false,
    collection: facts?.collection ?? false,
    parent: facts?.parent ?? false,
    feeModel: facts?.feeModel ?? 'service_quote',
    outputValue: facts?.outputValue ?? 'Not established by an authoritative source',
    transferModel: facts?.transferModel ?? 'Not established by an authoritative source',
    dependencies: facts?.dependencies ?? [],
    aliases: snap?.aliases ?? [],
    sources: [
      appSource('frontend/src/utils/ecosystemInboundIntent.ts', `creation operations for ${id}`),
      platformSource('packages/ecosystem-registry/data/capability-snapshot.json', `identity and chain for ${id}`),
      ...(facts ? [docSource('data/protocol-facts.json', `fee, batch, and collection facts for ${id}`)] : []),
    ],
  }
}

const establishedProtocolIds = [...creationProtocolIds, ...readOnlyProtocolIds].filter((id) => {
  const known = Boolean(snapshotFor(id) ?? registryFor(id))
  if (!known) console.warn(`generate-learning-manifest: skipping ${id}: no capability registry or snapshot entry establishes it`)
  return known
})
const protocols = establishedProtocolIds.map(buildProtocol)

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

const OPERATION_TO_GOAL = {
  inscribe: 'inscribe_text',
  deploy: 'deploy_token',
  mint: 'mint_token',
  etch: 'etch_rune',
  transfer: 'transfer_asset',
}

const OPERATION_TO_INTENT_ACTION = {
  inscribe: 'inscribe',
  deploy: 'deploy',
  mint: 'mint',
  etch: 'etch',
  transfer: 'transfer',
}

const GOAL_RANKING = {
  inscribe_text: { simplicity: 88, cost: 30, control: 45, batchEfficiency: 20 },
  inscribe_file: { simplicity: 80, cost: 40, control: 45, batchEfficiency: 25 },
  batch: { simplicity: 55, cost: 35, control: 65, batchEfficiency: 92 },
  collection: { simplicity: 45, cost: 55, control: 80, batchEfficiency: 40 },
  deploy_token: { simplicity: 62, cost: 60, control: 60, batchEfficiency: 10 },
  mint_token: { simplicity: 70, cost: 50, control: 40, batchEfficiency: 55 },
  etch_rune: { simplicity: 58, cost: 55, control: 55, batchEfficiency: 30 },
  transfer_asset: { simplicity: 85, cost: 25, control: 50, batchEfficiency: 15 },
  recover_order: { simplicity: 40, cost: 20, control: 75, batchEfficiency: 0 },
  learn_free: { simplicity: 95, cost: 0, control: 30, batchEfficiency: 0 },
}

const SUBVIEWS = {
  inscribe: 'text',
  stamps: 'stamps',
}

function stagesFor(feeModel, operation) {
  const signature = { kind: 'signature', label: 'Review and sign in your wallet', valueOwner: 'none', optional: false }
  if (feeModel === 'commit_reveal') {
    return [
      { kind: 'payment', label: 'Fund the commit address', valueOwner: 'user', optional: false },
      { kind: 'commit', label: 'Commit transaction', valueOwner: 'network_fee', optional: false },
      { kind: 'reveal', label: 'Reveal transaction', valueOwner: 'network_fee', optional: false },
      ...(operation === 'transfer' ? [{ kind: 'transfer', label: 'Transfer to receiver', valueOwner: 'user', optional: false }] : []),
      signature,
    ]
  }
  if (feeModel === 'keyless_p2a') {
    return [
      { kind: 'payment', label: 'Fund the mint payment address', valueOwner: 'user', optional: false },
      { kind: 'mint', label: 'Pay-to-anchor mint chain', valueOwner: 'network_fee', optional: false },
      signature,
    ]
  }
  if (feeModel === 'src20') {
    return [
      { kind: 'payment', label: 'Fund the mint inputs', valueOwner: 'user', optional: false },
      { kind: 'mint', label: 'SRC-20 mint transaction', valueOwner: 'network_fee', optional: false },
      signature,
    ]
  }
  if (feeModel === 'stamp_olga') {
    return [
      { kind: 'payment', label: 'Fund the stamp chain', valueOwner: 'user', optional: false },
      { kind: 'commit', label: 'Stamp chain transactions', valueOwner: 'network_fee', optional: false },
      signature,
    ]
  }
  if (feeModel === 'service_quote') {
    return [
      { kind: 'payment', label: 'Pay the in-app quote', valueOwner: 'user', optional: false },
      signature,
    ]
  }
  return [
    { kind: 'payment', label: 'Fund the transaction', valueOwner: 'user', optional: false },
    signature,
  ]
}

function safetyChecksFor(facts, protocolId) {
  const checks = [
    'Verify the network shown in the wallet matches mainnet before signing.',
    'Check every receiving address in the wallet review screen character by character.',
    'Confirm the total matches the in-app quote: network fee, service fee, and output value shown separately.',
  ]
  if (facts?.batch) checks.push('Review the per-item count before paying; batches fan out into multiple transactions.')
  if (protocolId === 'ordinals') checks.push('Check the asset preflight warning: inputs holding other assets are never auto-spent for fees.')
  return checks
}

const PROTOCOL_RANKING_ADJUSTMENT = {
  // OP_RETURN publishes plain public data with an unspendable output; it is a
  // precise tool, not the simple default for a first inscription.
  op_return: { simplicity: -13 },
}

function rankFor(protocolId, goal) {
  const base = GOAL_RANKING[goal]
  const adjustment = PROTOCOL_RANKING_ADJUSTMENT[protocolId]
  if (!adjustment) return base
  const ranking = { ...base }
  for (const [key, delta] of Object.entries(adjustment)) ranking[key] = Math.max(0, Math.min(100, base[key] + delta))
  return ranking
}

function buildWorkflow(protocol, operation, goalOverride, overrides = {}) {
  const facts = protocolFacts[protocol.id] ?? {}
  const goal = goalOverride ?? (operation === 'inscribe' ? 'inscribe_text' : OPERATION_TO_GOAL[operation])
  const isFile = overrides.variant === 'file'
  const id = overrides.id ?? `wf-${protocol.id.replace(/_/g, '-')}-${operation}${isFile ? '-file' : goal === 'batch' ? '-batch' : goal === 'collection' ? '-collection' : ''}`
  const feeModel = facts.feeModel ?? 'service_quote'
  const workspace = operation === 'transfer' && (protocol.id === 'ordinals' || protocol.id === 'stamps') ? 'inscription-transfer' : protocol.workspace
  const walkthrough = walkthroughRegistry.walkthroughs.find((w) => w.workflowIds?.includes(id) || w.workflowId === id)
  const scenario = scenarioRegistry.scenarios.find((s) => s.workflowId === id)

  const contentCategories =
    goal === 'inscribe_text'
      ? ['text']
      : protocol.id === 'stamps'
        ? ['image']
        : goal === 'inscribe_file'
          ? ['image', 'audio', 'video', 'model', 'json', 'other']
          : protocol.id === 'stamps'
            ? ['image']
            : ['text', 'image', 'audio', 'video', 'model', 'json', 'other']

  const goalMeta = {
    inscribe_text: { title: `Inscribe text on ${protocol.label}`, subview: protocol.id === 'stamps' ? 'stamps' : 'text' },
    inscribe_file: { title: `Inscribe a file on ${protocol.label}`, subview: protocol.id === 'stamps' ? 'stamps' : 'file' },
    batch: { title: `Create a batch on ${protocol.label}` },
    collection: { title: `Manage a collection on ${protocol.label}`, subview: 'parent' },
    deploy_token: { title: `Deploy a token on ${protocol.label}` },
    mint_token: { title: `Mint ${protocol.label}` },
    etch_rune: { title: `Etch a Rune on ${protocol.label}` },
    transfer_asset: { title: `Transfer ${protocol.label}` },
  }[goal]

  return {
    id,
    goal,
    title: overrides.title ?? goalMeta.title,
    protocolId: protocol.id,
    operation,
    workspace,
    ...(goalMeta.subview ? { subview: goalMeta.subview } : {}),
    chain: protocol.chain,
    network: 'mainnet',
    state: { ...protocol.state },
    stages: stagesFor(feeModel, operation),
    feeModel,
    contentCategories,
    batch: { supported: goal === 'batch' ? true : (facts.batch ?? false), ...(protocol.id === 'runes' ? { maxItems: 1000 } : {}) },
    collection: {
      supported: protocol.collection,
      parent: protocol.parent,
      delegate: protocol.parent,
      gallery: protocol.parent,
    },
    walletRoles: protocol.id === 'ordinals' ? ['payment', 'ordinals'] : ['payment'],
    prerequisites: [
      'A wallet with enough sats for the full quote.',
      ...(protocol.id === 'ordinals' ? ['Both payment and ordinals addresses visible in the app (the two-address model).'] : []),
    ],
    safetyChecks: safetyChecksFor(facts, protocol.id),
    guides: guidesForWorkflow(protocol.id, goal),
    ...(walkthrough ? { walkthroughId: walkthrough.id } : {}),
    ...(scenario ? { practiceScenarioId: scenario.id } : {}),
    recoveryOutcomeId: 'recovery-order-in-progress',
    intent: {
      action: OPERATION_TO_INTENT_ACTION[operation] ?? 'inscribe',
      ...(goalMeta.subview ? { sub: goalMeta.subview } : {}),
      ...(protocol.id === 'ordinals' ? { surface: 'ordinals', destination: 'ordinals' } : {}),
      ...(protocol.id === 'stamps' ? { destination: 'stamps' } : {}),
    },
    ranking: rankFor(protocol.id, goal),
    sources: [
      appSource('frontend/src/utils/ecosystemInboundIntent.ts', `${operation} support for ${protocol.id}`),
      ...(facts ? [docSource('data/protocol-facts.json', 'fee model and safety facts')] : []),
      appSource('backend/data/production-protocol-contract.json', 'deployment state for ' + protocol.id),
    ],
  }
}

function guidesForWorkflow(protocolId, goal) {
  const ids = new Set()
  for (const guide of appGuides) {
    if (protocolsForGuide(guide).includes(protocolId)) ids.add(guide.id)
  }
  if (goal === 'inscribe_text') ids.add('inscribe-text')
  if (goal === 'inscribe_file') ids.add('inscribe-files')
  if (goal === 'batch') ids.add('inscribe-basics')
  return [...ids].filter((id) => appGuideIds.has(id) || publicGuideIds.has(id))
}

const appGuides = await loadAppGuides()
const appGuideIds = new Set(appGuides.map((g) => g.id))

const PUBLIC_PAGES = [
  ['order-recovery', 'Order recovery', 'safety'],
  ['protocol-data-status', 'Live protocol data status', 'reference'],
  ['what-it-costs', 'What a transaction costs', 'reference'],
  ['asset-safety', 'Asset and UTXO safety', 'safety'],
  ['workspaces', 'Workspace map', 'reference'],
]

const publicGuideIds = new Set(PUBLIC_PAGES.map(([slug]) => `pub-${slug}`))

const creationWorkflows = []
for (const protocol of protocols) {
  if (!protocol.state.actionable) continue
  for (const operation of protocol.operations) {
    if (operation === 'inscribe') {
      creationWorkflows.push(buildWorkflow(protocol, 'inscribe', 'inscribe_text'))
      if (protocol.id !== 'ordinals') creationWorkflows.push(buildWorkflow(protocol, 'inscribe', 'inscribe_file', { variant: 'file' }))
    } else {
      creationWorkflows.push(buildWorkflow(protocol, operation))
    }
  }
}
// Ordinals-specific structured creation workflows
const ordinals = protocols.find((p) => p.id === 'ordinals')
creationWorkflows.push(buildWorkflow(ordinals, 'inscribe', 'batch', {
  id: 'wf-ordinals-inscribe-batch',
  title: 'Create a batch inscription on Ordinals',
}))
creationWorkflows.push(buildWorkflow(ordinals, 'inscribe', 'collection', {
  id: 'wf-ordinals-collection',
  title: 'Create a collection with a parent on Ordinals',
}))
creationWorkflows.push({
  id: 'wf-learn-free',
  goal: 'learn_free',
  title: 'Learn without spending: practice in the simulation studio',
  protocolId: 'ordinals',
  operation: 'none',
  workspace: 'home',
  chain: 'bitcoin',
  network: 'mainnet',
  state: { implemented: true, enabled: true, healthDependencies: [], actionable: false },
  stages: [],
  feeModel: 'service_quote',
  contentCategories: [],
  batch: { supported: false },
  collection: { supported: false, parent: false, delegate: false, gallery: false },
  walletRoles: ['none'],
  prerequisites: [],
  safetyChecks: ['The practice studio cannot create transactions, connect wallets, or reach the network.'],
  guides: ['first-inscription'],
  walkthroughId: walkthroughRegistry.walkthroughs[0]?.id,
  practiceScenarioId: scenarioRegistry.scenarios[0]?.id,
  recoveryOutcomeId: undefined,
  intent: { action: 'inscribe', sub: 'text' },
  ranking: GOAL_RANKING.learn_free,
  sources: [docSource('data/learning-config.json', 'practice-first learning route')],
})

// ---------------------------------------------------------------------------
// Guides
// ---------------------------------------------------------------------------

const guides = [
  ...appGuides.map((g) => ({
    id: g.id,
    title: g.title,
    category: g.category,
    surface: 'app',
    ...(workspaceOfGuide(g) ? { workspace: workspaceOfGuide(g) } : {}),
    steps: g.steps.map((s, i) => ({ id: stepId(g.id, i, s.title, s.id), title: s.title })),
    protocols: protocolsForGuide(g),
    sources: [appSource(`frontend/src/features/docs/content`, `guide ${g.id}`)],
  })),
  ...PUBLIC_PAGES.map(([slug, title, category]) => ({
    id: `pub-${slug}`,
    title,
    category,
    surface: 'public',
    publicPath: `/${slug}`,
    steps: [],
    protocols: [],
    sources: [docSource(`src/content/docs/${slug}.md`, 'public page')],
  })),
]

// ---------------------------------------------------------------------------
// Walkthroughs, scenarios, recovery
// ---------------------------------------------------------------------------

const walkthroughs = walkthroughRegistry.walkthroughs.map((w) => ({
  id: w.id,
  title: w.title,
  workflowId: w.workflowId,
  path: w.path,
  captureCommit: w.captureCommit,
  fixtureVersion: w.fixtureVersion,
  steps: w.steps,
  ...(w.practiceScenarioId ? { practiceScenarioId: w.practiceScenarioId } : {}),
  ...(w.lastCapturedAt ? { lastCapturedAt: w.lastCapturedAt } : {}),
  ...(w.lastVerifiedAt ? { lastVerifiedAt: w.lastVerifiedAt } : {}),
}))

const practiceScenarios = scenarioRegistry.scenarios.map((s) => ({
  id: s.id,
  title: s.title,
  workflowId: s.workflowId,
  path: s.path,
  goal: s.goal,
}))

const outcomeSources = [
  docSource('data/recovery-decision-table.json', 'diagnostic outcomes'),
  docSource('src/content/docs/protocol-data-status.md', 'order lifecycle and recovery semantics'),
]

const recovery = {
  guideId: learningConfig.recoveryGuideId,
  table: {
    entry: recoveryTable.entry,
    questions: recoveryTable.questions,
  },
  outcomes: recoveryTable.outcomes.map((o) => ({
    id: o.id,
    title: o.title,
    diagnosis: o.diagnosis,
    reversibility: o.reversibility,
    doNotPayAgain: o.doNotPayAgain,
    ...(o.workspace ? { workspace: o.workspace } : {}),
    guideId: o.guideId,
    stopConditions: o.stopConditions,
    nextAction: o.nextAction,
    evidence: o.evidence,
    whatNotToDo: o.whatNotToDo,
    sources: outcomeSources,
  })),
}

// ---------------------------------------------------------------------------
// Assemble + prove
// ---------------------------------------------------------------------------

const manifest = {
  schemaVersion: 1,
  generatedAt,
  generatorVersion: GENERATOR_VERSION,
  sourceCommits: commits,
  chain: 'bitcoin',
  network: 'mainnet',
  appOrigin: learningConfig.appOrigin,
  workflows: creationWorkflows,
  protocols,
  guides,
  walkthroughs,
  practiceScenarios,
  recovery,
  planner: learningConfig.planner,
  docsReturnOrigins: learningConfig.docsReturnOrigins,
}

// Prove cross references before writing.
const problems = []
for (const wf of manifest.workflows) {
  if (!workspaceSlugs.has(wf.workspace)) problems.push(`${wf.id}: unknown workspace ${wf.workspace}`)
  if (wf.practiceScenarioId && !manifest.practiceScenarios.some((s) => s.id === wf.practiceScenarioId)) {
    problems.push(`${wf.id}: unknown practice scenario ${wf.practiceScenarioId}`)
  }
  if (wf.walkthroughId && !manifest.walkthroughs.some((w) => w.id === wf.walkthroughId)) {
    problems.push(`${wf.id}: unknown walkthrough ${wf.walkthroughId}`)
  }
  for (const gid of wf.guides) {
    if (!manifest.guides.some((g) => g.id === gid)) problems.push(`${wf.id}: unknown guide ${gid}`)
  }
  try {
    buildInscribeLink({
      appOrigin: manifest.appOrigin,
      intent: { workspace: wf.workspace, sub: wf.subview, ...wf.intent, network: 'mainnet' },
      docsReturnOrigins: manifest.docsReturnOrigins,
    })
  } catch (error) {
    problems.push(`${wf.id}: unsafe or rejected app link: ${error.message}`)
  }
}
for (const outcome of manifest.recovery.outcomes) {
  if (outcome.guideId && !manifest.guides.some((g) => g.id === outcome.guideId)) {
    problems.push(`recovery outcome ${outcome.id}: unknown guide ${outcome.guideId}`)
  }
}
const audit = auditRecoveryTable(manifest.recovery.table, manifest.recovery.outcomes.map((o) => `outcome:${o.id}`))
for (const id of audit.unreachable) problems.push(`recovery question unreachable: ${id}`)
for (const loop of audit.loops) problems.push(`recovery loop: ${loop.from} -> ${loop.to}`)
for (const id of audit.missingOutcomes) problems.push(`recovery outcome missing from manifest: ${id}`)
for (const id of audit.deadEnds) problems.push(`recovery question dead end: ${id}`)
for (const id of reachableOutcomeIds(manifest.recovery.table)) {
  if (!manifest.recovery.outcomes.some((o) => `outcome:${o.id}` === id)) {
    problems.push(`recovery table emits unknown outcome ${id}`)
  }
}

// Planner coverage: every actionable workflow is reachable by a default input.
const goals = [...new Set(manifest.workflows.filter((w) => w.state.actionable).map((w) => w.goal))]
for (const goal of goals) {
  const result = planGoal(manifest, {
    goal,
    protocol: 'help_me_choose',
    chain: 'bitcoin',
    network: 'mainnet',
    wallet: 'unknown',
    receivingAddressReady: true,
    experience: 'intermediate',
    priority: 'simplest',
    practiceFirst: false,
  })
  if (!result.recommended) problems.push(`planner coverage: goal ${goal} resolves to no workflow`)
}

if (problems.length > 0) {
  console.error('generate-learning-manifest: cross-reference proof failed:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

const parsed = parseManifest(manifest)

mkdirSync(join(outPath, '..'), { recursive: true })
writeFileSync(outPath, JSON.stringify(parsed, null, 2) + '\n')
console.log(`manifest written: ${outPath}`)
console.log(`  workflows: ${parsed.workflows.length}  protocols: ${parsed.protocols.length}  guides: ${parsed.guides.length}`)
console.log(`  recovery outcomes: ${parsed.recovery.outcomes.length}  walkthroughs: ${parsed.walkthroughs.length}  scenarios: ${parsed.practiceScenarios.length}`)
