// llms.txt for the portal.
//
// Generated from the registry so it can never drift from the site. It points at
// each project's own documentation site, because those sites are the authority
// on their subject and this portal is a discovery layer over them.
import type { APIRoute } from 'astro';
import { protocols, products, chains, provenance } from '@universe/ecosystem-registry';

const SITE = 'https://docs.bitcoinuniverse.io';

export const GET: APIRoute = () => {
  const lines: string[] = [];

  lines.push('# Bitcoin Universe Documentation');
  lines.push('');
  lines.push(
    '> The documentation portal for the Bitcoin Universe estate: products, protocols, chains, APIs, and indexers across Bitcoin, Dogecoin, and Zcash. Each project owns its own documentation site. This portal is the discovery and comparison layer over them.',
  );
  lines.push('');
  lines.push('## How to use this estate');
  lines.push('');
  lines.push(
    '- Project documentation sites are the authority for their subject. Prefer them for task guides, reference, and release notes.',
  );
  lines.push(
    '- This portal is the authority for cross-project comparison, shared terminology, and which protocol our products actually implement.',
  );
  lines.push(
    `- Structured data for the whole estate: ${SITE}/ecosystem.json. It records the exact ${provenance.repository} commit the capability data came from.`,
  );
  lines.push(
    '- Implemented is not the same as available in production. Capability data states what the code does; status pages state what is switched on.',
  );
  lines.push('');

  lines.push('## Start');
  lines.push('');
  lines.push(`- [What Bitcoin Universe is](${SITE}/start/what-bitcoin-universe-is/)`);
  lines.push(`- [Safety in sixty seconds](${SITE}/start/safety/)`);
  lines.push(`- [Choose your path](${SITE}/start/choose-your-path/)`);
  lines.push('');

  lines.push('## Products');
  lines.push('');
  for (const product of products) {
    lines.push(
      `- [${product.name}](${SITE}/products/${product.id}/): ${product.tagline} Documentation: ${product.documentationSite}`,
    );
  }
  lines.push('');

  lines.push('## Chains');
  lines.push('');
  for (const chain of chains) {
    lines.push(
      `- [${chain.name} (${chain.ticker})](${SITE}/chains/#${chain.id}): networks ${chain.networks.join(', ')}, ${chain.blockTargetMinutes} minute block target.`,
    );
  }
  lines.push('');

  lines.push('## Protocols');
  lines.push('');
  for (const protocol of protocols) {
    const availability = protocol.marketplace
      ? protocol.marketplace.availability
      : protocol.universeImplementation
        ? 'indexed, no trade path'
        : 'documented only';
    const site = protocol.documentationSite ? ` Specification: ${protocol.documentationSite}` : '';
    lines.push(
      `- [${protocol.name}](${SITE}/protocols/${protocol.id}/): ${protocol.chain}, carried by ${protocol.carrier}. In our products: ${availability}.${site}`,
    );
  }
  lines.push('');

  lines.push('## Status and trust');
  lines.push('');
  lines.push(`- [How to read our status](${SITE}/status/)`);
  lines.push(`- [Source provenance](${SITE}/status/provenance/)`);
  lines.push(`- [Developer overview](${SITE}/developers/)`);
  lines.push(`- [Support](${SITE}/support/)`);
  lines.push('');

  lines.push('## Optional');
  lines.push('');
  lines.push(
    `- [Machine-readable ecosystem index](${SITE}/ecosystem.json): every product, protocol, and chain with capability data and provenance.`,
  );
  lines.push('- Source repositories: https://github.com/bitcoinuniverseio');
  lines.push('');

  return new Response(`${lines.join('\n')}`, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
};
