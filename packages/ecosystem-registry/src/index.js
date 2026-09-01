// The ecosystem registry: one join of the narrative protocol data, the product
// list, the chain definitions, and the capability snapshot generated from Core.
//
// Every catalog page on the portal reads from here, so the Protocol Atlas and the
// product pages cannot drift apart: they are two views of the same records.

import capabilitySnapshot from '../data/capability-snapshot.json' with { type: 'json' };
import protocolData from '../data/protocols.json' with { type: 'json' };
import productData from '../data/products.json' with { type: 'json' };
import chainData from '../data/chains.json' with { type: 'json' };

export const provenance = capabilitySnapshot.provenance;
export const chains = chainData.chains;
export const products = productData.products;

const capabilities = capabilitySnapshot.protocols;

/** Maps a capability surface key to the product name a reader recognises. */
export const SURFACE_LABELS = {
  main: 'Core',
  wallet: 'Wallet',
  inscribe: 'Inscribe',
  stampdex: 'StampDEX',
};

/** How we describe each marketplace availability value to a reader. */
export const AVAILABILITY_LABELS = {
  enabled: {
    label: 'Enabled',
    summary: 'Implemented and reachable in the product, subject to live status.',
  },
  'read-only': {
    label: 'Read only',
    summary: 'You can see this protocol in the product. No trade action is implemented.',
  },
  'feature-gated': {
    label: 'Feature gated',
    summary: 'Implemented, but switched off unless an operator enables the gate.',
  },
  'feature-gated-testnet-only': {
    label: 'Feature gated, testnet only',
    summary: 'Implemented for testnet behind a gate. Not available on mainnet.',
  },
};

/** How we describe each execution mode. */
export const MODE_LABELS = {
  'in-app-execution': 'Built and executed inside Universe products',
  'external-execution': 'Executed through an external venue or protocol service',
  'read-only': 'Read paths only',
  'psbt-routing-only': 'Routes signed transactions; never broadcasts a settlement',
  'trade-preview-only': 'Preview only; no executable trade',
  'live-read-only': 'Live read paths only',
};

/**
 * A protocol declares a broad action list per surface, but the marketplace policy
 * is the authority on which of those actions are actually implemented. Runes, for
 * example, declares the full marketplace action list on the Core surface while its
 * policy marks every trade action unsupported. Publishing the declared list would
 * claim a capability the same page then denies, so the marketplace surface is
 * narrowed to the actions the policy confirms.
 */
function resolveSurfaces(capability) {
  if (!capability) return [];
  const policy = capability.marketplace;
  const supported = policy?.actions?.supported
    ? new Set(policy.actions.supported.map((entry) => entry.action))
    : null;

  return Object.entries(capability.surfaces ?? {})
    .map(([key, surface]) => {
      // Only the surface that owns the marketplace policy is constrained by it.
      // Wallet and Inscribe actions are creation and custody paths, not trades.
      if (!supported || !policy?.owner || key !== policy.owner) return surface;
      const actions = surface.actions.filter((action) => supported.has(action));
      return { ...surface, actions };
    })
    .filter((surface) => surface.actions.length > 0);
}

function joinProtocol(entry) {
  const capability = entry.capabilityId ? (capabilities[entry.capabilityId] ?? null) : null;
  return {
    ...entry,
    capability,
    // A protocol is "supported somewhere" only if the product code says so.
    surfaces: resolveSurfaces(capability),
    marketplace: capability?.marketplace ?? null,
    indexer: capability?.indexer ?? null,
    confirmation: capability?.confirmation ?? null,
    reorg: capability?.reorg ?? null,
    freshness: capability?.freshness ?? null,
    sourceOfTruth: capability?.sourceOfTruth ?? null,
    ownershipModel: capability?.ownershipModel ?? null,
    decimals: capability?.decimals ?? null,
    aliases: capability?.aliases ?? [],
  };
}

export const protocols = protocolData.protocols.map(joinProtocol);

export function getProtocol(id) {
  return protocols.find((p) => p.id === id) ?? null;
}

export function protocolsByChain(chainId) {
  return protocols.filter((p) => p.chain === chainId);
}

export function getProduct(id) {
  return products.find((p) => p.id === id) ?? null;
}

export function getChain(id) {
  return chains.find((c) => c.id === id) ?? null;
}

/**
 * Protocols a product exposes, derived from the capability snapshot rather than
 * from a hand-maintained list, with the actions that product implements.
 */
export function protocolsForProduct(productId) {
  const product = getProduct(productId);
  if (!product?.capabilitySurface) return [];
  const surface = product.capabilitySurface;
  return protocols
    .map((protocol) => {
      // Read from the resolved surfaces so a product page can never advertise an
      // action the protocol's own policy marks unsupported.
      const match = protocol.surfaces.find(
        (candidate) => candidate.label === SURFACE_LABELS[surface],
      );
      return match ? { protocol, actions: match.actions } : null;
    })
    .filter(Boolean);
}

/** Every protocol that has a documentation site of its own. */
export function protocolsWithSites() {
  return protocols.filter((p) => p.documentationSite);
}

/**
 * Consistency checks the build runs so a broken join fails the build rather than
 * publishing a page that quietly says nothing.
 */
export function validateRegistry() {
  const problems = [];
  const chainIds = new Set(chains.map((c) => c.id));
  const seen = new Set();

  for (const p of protocols) {
    if (seen.has(p.id)) problems.push(`duplicate protocol id: ${p.id}`);
    seen.add(p.id);
    if (!chainIds.has(p.chain)) problems.push(`protocol ${p.id} has unknown chain ${p.chain}`);
    if (p.capabilityId && !capabilities[p.capabilityId]) {
      problems.push(`protocol ${p.id} points at missing capability ${p.capabilityId}`);
    }
    if (!p.purpose || p.purpose.length < 20) {
      problems.push(`protocol ${p.id} has no usable purpose statement`);
    }
  }

  // Every capability in the snapshot must be represented in the Atlas, or the
  // Atlas is silently hiding something the product supports.
  for (const id of Object.keys(capabilities)) {
    if (!protocols.some((p) => p.capabilityId === id)) {
      problems.push(`capability ${id} exists in Core but has no Atlas entry`);
    }
  }

  for (const product of products) {
    if (!chainIds.has(product.chains[0])) {
      problems.push(`product ${product.id} has unknown chain ${product.chains[0]}`);
    }
  }

  return problems;
}
