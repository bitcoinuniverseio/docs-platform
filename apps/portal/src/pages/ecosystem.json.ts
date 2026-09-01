// The machine-readable ecosystem index.
//
// One document describing every product, protocol, chain, and documentation site
// in the public estate, with the exact Core commit the capability data came from.
// This is what the public documentation MCP and any external tool should read
// instead of scraping pages.
import type { APIRoute } from 'astro';
import {
  protocols,
  products,
  chains,
  provenance,
  protocolsForProduct,
} from '@universe/ecosystem-registry';
import { siteOrigin, withBase } from '../lib/paths';

export const GET: APIRoute = ({ site }) => {
  // Absolute URLs must match the origin this build is actually served from, so a
  // Pages build under a project path does not publish production URLs.
  const SITE = siteOrigin(site) + withBase('');
  const body = {
    $schema: `${SITE}/schemas/ecosystem-index.schema.json`,
    generator: 'docs.bitcoinuniverse.io',
    description:
      'Machine-readable index of the Bitcoin Universe public documentation estate. Each project owns its own documentation site; this index points at those sites and records the capability data behind the portal.',
    provenance: {
      capabilitySource: {
        repository: provenance.repository,
        sourcePath: provenance.sourcePath,
        commit: provenance.sourceCommit,
        registryCommit: provenance.registryCommit,
        registryCommittedAt: provenance.registryCommittedAt,
      },
    },
    chains: chains.map((chain) => ({
      id: chain.id,
      name: chain.name,
      ticker: chain.ticker,
      networks: chain.networks,
      blockTargetMinutes: chain.blockTargetMinutes,
      portalUrl: `${SITE}/chains/#${chain.id}`,
    })),
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      tagline: product.tagline,
      chains: product.chains,
      audiences: product.audiences,
      documentationRepository: product.documentationRepository,
      documentationSite: product.documentationSite,
      sourceRepository: product.sourceRepository,
      sourceVisibility: product.sourceVisibility,
      liveUrl: product.liveUrl,
      statusEndpoints: product.statusEndpoints,
      portalUrl: `${SITE}/products/${product.id}/`,
      implementedProtocols: protocolsForProduct(product.id).map(({ protocol, actions }) => ({
        id: protocol.id,
        actions,
      })),
    })),
    protocols: protocols.map((protocol) => ({
      id: protocol.id,
      name: protocol.name,
      chain: protocol.chain,
      carrier: protocol.carrier,
      family: protocol.family,
      purpose: protocol.purpose,
      operations: protocol.operations,
      aliases: protocol.aliases,
      origin: protocol.origin,
      specificationRepository: protocol.repository,
      documentationSite: protocol.documentationSite,
      universeImplementation: protocol.universeImplementation,
      portalUrl: `${SITE}/protocols/${protocol.id}/`,
      marketplace: protocol.marketplace
        ? {
            availability: protocol.marketplace.availability,
            mode: protocol.marketplace.mode,
            featureGate: protocol.marketplace.featureGate,
            supportedActions: protocol.marketplace.actions.supported.map((a) => a.action),
            unsupportedActions: protocol.marketplace.actions.unsupported,
          }
        : null,
      confirmation: protocol.confirmation,
      reorg: protocol.reorg,
      indexer: protocol.indexer,
    })),
  };

  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
};
