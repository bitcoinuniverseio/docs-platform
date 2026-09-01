// The Bitcoin Universe documentation portal.
// Static build for docs.bitcoinuniverse.io. Search is Pagefind, bundled by
// Starlight: local, loaded on demand, no external service.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';
import rehypeTableScroll from '@universe/docs-design-system/integrations/rehype-table-scroll';
import { codeBlockAccessibility } from '@universe/docs-design-system/integrations/ec-code-block-a11y';

export default defineConfig({
  markdown: {
    rehypePlugins: [rehypeTableScroll],
  },
  site: 'https://docs.bitcoinuniverse.io',
  trailingSlash: 'ignore',
  integrations: [
    starlight({
      expressiveCode: { plugins: [codeBlockAccessibility()] },
      title: 'Bitcoin Universe Docs',
      description:
        'Documentation for every Bitcoin Universe product, protocol, API, and indexer: Core, Wallet, Inscribe, StampDEX, Zerdinals, Forked Felines, Drops, and the protocols they run on.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/bitcoinuniverseio',
        },
      ],
      customCss: [
        '@fontsource-variable/geist',
        '@fontsource-variable/geist-mono',
        '@universe/docs-design-system/styles/universe.css',
      ],
      editLink: {
        baseUrl: 'https://github.com/bitcoinuniverseio/docs-platform/edit/develop/apps/portal/',
      },
      lastUpdated: true,
      pagination: true,
      credits: false,
      sidebar: [
        {
          label: 'Start',
          items: [
            { label: 'What Bitcoin Universe is', slug: 'start/what-bitcoin-universe-is' },
            { label: 'Safety in sixty seconds', slug: 'start/safety' },
            { label: 'Choose your path', slug: 'start/choose-your-path' },
          ],
        },
        {
          label: 'Products',
          items: [{ label: 'Product catalog', slug: 'products' }],
        },
        {
          label: 'Protocols',
          items: [{ label: 'Protocol Atlas', slug: 'protocols' }],
        },
        {
          label: 'Developers',
          items: [
            { label: 'Overview', slug: 'developers' },
            { label: 'Wallet provider API', slug: 'developers/wallet-provider-api' },
          ],
        },
        {
          label: 'Status & Trust',
          items: [
            { label: 'How to read our status', slug: 'status' },
            { label: 'Source provenance', slug: 'status/provenance' },
          ],
        },
        {
          label: 'Support',
          items: [{ label: 'Getting help', slug: 'support' }],
        },
      ],
      plugins: [
        starlightLinksValidator({
          errorOnRelativeLinks: false,
        }),
      ],
    }),
  ],
});
