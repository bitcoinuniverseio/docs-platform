# docs-platform

The Bitcoin Universe documentation platform: the portal at [docs.bitcoinuniverse.io](https://docs.bitcoinuniverse.io), its design system, content schemas, source pinning, and release tooling.

## How it works

Every public `bitcoinuniverseio` repository owns its documentation and declares it in a root `docs.manifest.json`. This platform validates those manifests, pins each source repository to an exact commit in `sources.lock.json`, and builds one coherent portal from those pinned commits. Nothing here follows a moving branch, and every published page records the source commit it was built from.

```
source repos (docs.manifest.json)
        |  validated against packages/content-schema
        v
sources.lock.json  (exact commit SHAs, manifest hashes)
        |  tooling/sync fetch
        v
apps/portal  (Astro + Starlight, static build)
        |
        v
docs.bitcoinuniverse.io
```

## Workspace

| Path | What it is |
| --- | --- |
| `apps/portal` | The public documentation portal |
| `packages/design-system` | Shared theme, tokens, and build helpers for documentation surfaces |
| `packages/content-schema` | The `docs.manifest.json` schema, TypeScript types, and a zero-dependency validator |
| `packages/ecosystem-registry` | Protocol, product, and chain data, plus the capability snapshot generated from Core |
| `tooling/sync` | Pinned-source synchronization: `lock`, `fetch`, `verify` |

## Where capability claims come from

The Protocol Atlas and the product pages are generated from
`packages/ecosystem-registry`, not hand-written. Its `capability-snapshot.json` is
produced from the protocol registry inside the private `core` repository and
records the exact Core commit it came from, so every support claim on the portal
traces back to product code rather than to a maintainer's memory.

```bash
node packages/ecosystem-registry/bin/generate-capability-snapshot.mjs --core /path/to/core
```

The generator refuses to write a snapshot containing anything that looks like a
host, address, credential, or filesystem path. Capability truth is public;
infrastructure detail is not.

Two rules are enforced by tests rather than by review:

- A surface never advertises an action the protocol's own marketplace policy marks
  unsupported. Without this, a page claims a capability it denies further down.
- Every unsupported action carries the reason recorded in the registry. The reason
  is the useful part; a table of ticks teaches nothing.

## Develop

```bash
pnpm install
pnpm test          # workspace test suites
pnpm --filter @universe/docs-portal dev
```

Validate a manifest from any repository, with bare Node and no install:

```bash
node packages/content-schema/bin/validate-manifest.mjs path/to/docs.manifest.json
```

Pin, fetch, and verify sources (uses `GH_TOKEN` when set):

```bash
pnpm sync:lock
pnpm sync:fetch
pnpm sync:verify
```

## Branches and release

`develop` is the working branch. Production deployments build only from the explicitly configured production ref with a verified `sources.lock.json`; every deployment records the exact portal commit and source commits it was built from.

## Contributing

See the organization [CONTRIBUTING.md](https://github.com/bitcoinuniverseio/.github/blob/main/CONTRIBUTING.md) and [documentation conventions](https://github.com/bitcoinuniverseio/.github/blob/main/docs/conventions.md). Vulnerabilities go through private reporting per [SECURITY.md](https://github.com/bitcoinuniverseio/.github/blob/main/SECURITY.md).

## License

MIT for platform code in this repository. Ingested documentation content remains under its source repository's license.
