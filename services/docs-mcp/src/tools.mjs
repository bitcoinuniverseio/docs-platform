// The tool implementations, kept free of any transport concern so they can be
// tested directly and reused if the server ever speaks something other than
// stdio.
//
// Everything here is read-only and sourced from the committed ecosystem registry.
// The server never reaches into a private repository and never writes anything.

import {
  protocols,
  products,
  chains,
  provenance,
  getProtocol,
  getProduct,
  getChain,
  protocolsForProduct,
  AVAILABILITY_LABELS,
} from '@universe/ecosystem-registry';
import health from '@universe/ecosystem-registry/data/docs-health.json' with { type: 'json' };

const SITE = 'https://docs.bitcoinuniverse.io';

/** Every answer carries where it came from, so a caller can check it. */
function withProvenance(payload) {
  return {
    ...payload,
    provenance: {
      capabilitySource: `${provenance.repository}@${provenance.sourceCommit}`,
      sourcePath: provenance.sourcePath,
      note: 'Capability data states what product code implements. It is not a statement that a feature is enabled in production.',
    },
  };
}

function protocolSummary(p) {
  return {
    id: p.id,
    name: p.name,
    chain: p.chain,
    carrier: p.carrier,
    purpose: p.purpose,
    operations: p.operations,
    aliases: p.aliases,
    origin: p.origin.kind === 'universe-original' ? 'Bitcoin Universe' : (p.origin.creator ?? 'external'),
    documentationSite: p.documentationSite,
    specificationRepository: p.repository,
    universeImplementation: p.universeImplementation,
    portalUrl: `${SITE}/protocols/${p.id}/`,
    marketplaceAvailability: p.marketplace?.availability ?? null,
  };
}

function haystack(p) {
  return [p.id, p.name, p.carrier, p.purpose, p.family, ...(p.aliases ?? []), ...(p.operations ?? [])]
    .join(' ')
    .toLowerCase();
}

export const tools = {
  search_documentation: {
    description:
      'Search the Bitcoin Universe documentation estate for protocols, products, and chains by name, alias, ticker, carrier, or purpose. Returns pointers to the owning documentation site for each hit.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text. Matches names, aliases, carriers, and purposes.' },
        chain: { type: 'string', enum: ['bitcoin', 'dogecoin', 'zcash'] },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 15 },
      },
      required: ['query'],
    },
    handler({ query, chain, limit = 15 }) {
      const q = String(query).toLowerCase().trim();
      if (!q) return withProvenance({ results: [], note: 'Empty query.' });

      const protocolHits = protocols
        .filter((p) => (chain ? p.chain === chain : true))
        .map((p) => {
          const hay = haystack(p);
          // Exact id or alias beats a substring match on the purpose text.
          let score = 0;
          if (p.id === q || p.aliases?.includes(q)) score = 100;
          else if (p.name.toLowerCase() === q) score = 95;
          else if (p.name.toLowerCase().includes(q)) score = 60;
          else if (hay.includes(q)) score = 30;
          return { p, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ p }) => ({ kind: 'protocol', ...protocolSummary(p) }));

      const productHits = products
        .filter((p) => `${p.id} ${p.name} ${p.tagline} ${p.role}`.toLowerCase().includes(q))
        .map((p) => ({
          kind: 'product',
          id: p.id,
          name: p.name,
          tagline: p.tagline,
          documentationSite: p.documentationSite,
          portalUrl: `${SITE}/products/${p.id}/`,
        }));

      const chainHits = chains
        .filter((c) => `${c.id} ${c.name} ${c.ticker}`.toLowerCase().includes(q))
        .map((c) => ({ kind: 'chain', id: c.id, name: c.name, ticker: c.ticker, portalUrl: `${SITE}/chains/#${c.id}` }));

      return withProvenance({
        query,
        results: [...protocolHits, ...productHits, ...chainHits].slice(0, limit),
      });
    },
  },

  get_protocol: {
    description:
      'Full dossier for one protocol: carrier, origin, operations, which Universe products implement it, the reason for every action that is not implemented, and its indexing, confirmation, and reorganisation behaviour.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Protocol id, for example runes or brc20.' } },
      required: ['id'],
    },
    handler({ id }) {
      const p = getProtocol(id) ?? protocols.find((x) => x.aliases?.includes(String(id).toLowerCase()));
      if (!p) {
        return withProvenance({
          error: `No protocol with id "${id}".`,
          availableIds: protocols.map((x) => x.id),
        });
      }
      return withProvenance({
        ...protocolSummary(p),
        specificationHome: p.specificationHome,
        ownershipModel: p.ownershipModel,
        decimals: p.decimals,
        surfaces: p.surfaces,
        marketplace: p.marketplace
          ? {
              availability: p.marketplace.availability,
              availabilityMeaning: AVAILABILITY_LABELS[p.marketplace.availability]?.summary ?? null,
              mode: p.marketplace.mode,
              featureGate: p.marketplace.featureGate,
              implementedActions: p.marketplace.actions.supported.map((a) => a.action),
              notImplemented: p.marketplace.actions.unsupported,
            }
          : null,
        indexer: p.indexer,
        confirmation: p.confirmation,
        reorg: p.reorg,
        freshness: p.freshness,
        sourceOfTruth: p.sourceOfTruth,
      });
    },
  },

  get_product: {
    description:
      'One Bitcoin Universe product: what it is for, its documentation site, its status endpoints, and the protocols it implements with the actions it implements for each.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Product id, for example core or wallet.' } },
      required: ['id'],
    },
    handler({ id }) {
      const product = getProduct(id);
      if (!product) {
        return withProvenance({ error: `No product with id "${id}".`, availableIds: products.map((p) => p.id) });
      }
      return withProvenance({
        ...product,
        portalUrl: `${SITE}/products/${product.id}/`,
        implementedProtocols: protocolsForProduct(product.id).map(({ protocol, actions }) => ({
          id: protocol.id,
          name: protocol.name,
          actions,
        })),
      });
    },
  },

  list_catalog: {
    description:
      'List everything in the estate: protocols, products, or chains. Use this to discover ids before calling the get_ tools.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['protocols', 'products', 'chains'], default: 'protocols' },
        chain: { type: 'string', enum: ['bitcoin', 'dogecoin', 'zcash'] },
      },
    },
    handler({ kind = 'protocols', chain }) {
      if (kind === 'products') {
        return withProvenance({
          products: products.map((p) => ({
            id: p.id,
            name: p.name,
            tagline: p.tagline,
            chains: p.chains,
            documentationSite: p.documentationSite,
          })),
        });
      }
      if (kind === 'chains') {
        return withProvenance({ chains });
      }
      const list = chain ? protocols.filter((p) => p.chain === chain) : protocols;
      return withProvenance({ protocols: list.map(protocolSummary) });
    },
  },

  get_capability: {
    description:
      'Answer whether a Universe product implements a specific action for a specific protocol, and if not, give the recorded reason. Use this instead of guessing from a feature list.',
    inputSchema: {
      type: 'object',
      properties: {
        protocol: { type: 'string' },
        action: {
          type: 'string',
          description: 'For example buy, list, unlist, make-offer, settle, inscribe, mint, transfer.',
        },
      },
      required: ['protocol', 'action'],
    },
    handler({ protocol, action }) {
      const p = getProtocol(protocol) ?? protocols.find((x) => x.aliases?.includes(String(protocol).toLowerCase()));
      if (!p) return withProvenance({ error: `No protocol with id "${protocol}".` });

      const surfaces = p.surfaces
        .filter((s) => s.actions.includes(action))
        .map((s) => s.label);

      const unsupported = p.marketplace?.actions.unsupported.find((entry) => entry.action === action);

      return withProvenance({
        protocol: p.id,
        action,
        implementedIn: surfaces,
        implemented: surfaces.length > 0,
        reasonNotImplemented: unsupported?.reason ?? null,
        marketplaceAvailability: p.marketplace?.availability ?? null,
        caution:
          'Implemented means the product code supports it. Whether it is switched on in production is reported separately at ' +
          `${SITE}/status/live/`,
      });
    },
  },

  get_documentation_health: {
    description:
      'Which repositories in the estate publish a valid documentation manifest and are therefore ingestable by the portal, and what the rest are missing.',
    inputSchema: {
      type: 'object',
      properties: {
        onlyProblems: { type: 'boolean', default: false, description: 'Return only repositories with findings.' },
      },
    },
    handler({ onlyProblems = false }) {
      const rows = health.repositories
        .filter((r) => (onlyProblems ? !r.manifest.valid || r.problems.length > 0 : true))
        .map((r) => ({
          repository: r.repository,
          ingestable: r.manifest.valid,
          lifecycle: r.lifecycle,
          documentationUrl: r.documentationUrl,
          problems: r.problems,
        }));
      return withProvenance({
        summary: health.summary,
        generatedAt: health.generatedAt,
        repositories: rows,
      });
    },
  },

  get_interfaces: {
    description:
      'Every API, schema, specification, CLI, and SDK the estate publishes, taken from what each repository declares, with the exact commit each one is published at.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['openapi', 'asyncapi', 'jsonSchema', 'cli', 'sdk', 'specifications', 'all'],
          default: 'all',
        },
      },
    },
    handler({ kind = 'all' }) {
      const valid = health.repositories.filter((r) => r.manifest.valid);
      const collect = (k) =>
        valid.flatMap((r) =>
          (k === 'specifications' ? (r.specifications ?? []) : (r.contracts?.[k] ?? [])).map((path) => ({
            repository: r.repository,
            path,
            url: `https://github.com/${r.repository}/blob/${r.commit}/${path}`,
            lifecycle: r.lifecycle,
          })),
        );

      if (kind !== 'all') return withProvenance({ kind, entries: collect(kind) });
      return withProvenance({
        openapi: collect('openapi'),
        asyncapi: collect('asyncapi'),
        jsonSchema: collect('jsonSchema'),
        cli: collect('cli'),
        sdk: collect('sdk'),
        specifications: collect('specifications'),
      });
    },
  },

  get_chain: {
    description:
      'Chain and network definitions: block target, finality wording, how data is carried, and which protocols live there.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', enum: ['bitcoin', 'dogecoin', 'zcash'] } },
      required: ['id'],
    },
    handler({ id }) {
      const chain = getChain(id);
      if (!chain) return withProvenance({ error: `No chain with id "${id}".` });
      return withProvenance({
        ...chain,
        portalUrl: `${SITE}/chains/#${chain.id}`,
        protocols: protocols.filter((p) => p.chain === chain.id).map((p) => ({ id: p.id, name: p.name })),
      });
    },
  },
};

export const toolList = Object.entries(tools).map(([name, tool]) => ({
  name,
  description: tool.description,
  inputSchema: tool.inputSchema,
}));

export function callTool(name, args) {
  const tool = tools[name];
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.handler(args ?? {});
}
