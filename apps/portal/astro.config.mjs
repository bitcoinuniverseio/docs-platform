// The Bitcoin Universe documentation portal.
// Static build for docs.bitcoinuniverse.io. Search is Pagefind, bundled by
// Starlight: local, loaded on demand, no external service.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';
import rehypeTableScroll from '@universe/docs-design-system/integrations/rehype-table-scroll';
import { codeBlockAccessibility } from '@universe/docs-design-system/integrations/ec-code-block-a11y';

// The production home is docs.bitcoinuniverse.io. That domain currently serves a
// GitBook site, so until it is cut over the portal also publishes to GitHub Pages
// under a project path. Both builds come from this one config: set SITE_URL and
// BASE_PATH for the Pages build, and the defaults produce the production build.
const SITE_URL = process.env.SITE_URL ?? 'https://docs.bitcoinuniverse.io';
const BASE_PATH = process.env.BASE_PATH ?? undefined;

export default defineConfig({
  markdown: {
    rehypePlugins: [rehypeTableScroll],
  },
  site: SITE_URL,
  base: BASE_PATH,
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
          items: [{ label: 'Product catalog', link: '/products/' }],
        },
        {
          label: 'Protocols',
          items: [{ label: 'Protocol Atlas', link: '/protocols/' }],
        },
        {
          label: 'Developers',
          items: [
            { label: 'Overview', slug: 'developers' },
            { label: 'Interface directory', link: '/developers/interfaces/' },
          ],
        },
        {
          label: 'Chains',
          items: [{ label: 'Chains and networks', link: '/chains/' }],
        },
        {
          label: 'Status and trust',
          items: [
            { label: 'How to read our status', slug: 'status' },
            { label: 'Live status', link: '/status/live/' },
            { label: 'Documentation health', link: '/status/documentation-health/' },
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
          // Catalog routes are generated from the ecosystem registry as custom
          // Astro pages, so the validator cannot see them in the content
          // collection. The registry test suite checks these links instead: it
          // fails the build if a protocol or product id is missing or duplicated.
          exclude: [
            '/protocols/**',
            '/products/**',
            '/chains/**',
            '/status/live/**',
            '/status/documentation-health/**',
            '/developers/interfaces/**',
          ],
        }),
      ],
    }),
  ],
});
