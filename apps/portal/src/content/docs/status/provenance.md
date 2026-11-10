---
title: Source provenance
description: How portal content and source references can be checked.
---

The portal builds from content in the docs-platform repository and its local ecosystem registry. Source references can help verify individual claims, but not every page records an exact source commit.

## The provenance chain

1. Repositories that participate in source synchronization declare documentation in a root `docs.manifest.json`, validated against the [public schema](https://github.com/bitcoinuniverseio/docs-platform/blob/main/packages/content-schema/schemas/docs.manifest.schema.json). Not every repository has a manifest.
2. [`sources.lock.json`](https://github.com/bitcoinuniverseio/docs-platform/blob/main/sources.lock.json) records commits and manifest hashes for a historical set of sources. The build does not fetch or ingest those sources; a lock entry alone does not establish the provenance of a portal page.
3. The ecosystem registry's capability snapshot records the Core commit from which it was generated. Other claims should be checked against the references provided on their pages.

## Verifying a claim

1. Find the source repository (linked from the page or catalogued in the [product catalog](/products/) and [Protocol Atlas](/protocols/)).
2. Follow the page's references and, where a commit is recorded, inspect that version of the source.
3. If a claim is unsupported or a reference is missing, [report it](https://github.com/bitcoinuniverseio/.github/blob/main/SUPPORT.md).

## Operator labeling

Every data source in Universe products is labeled as Universe-operated or third-party. Production blockchain data comes from Universe-operated nodes and indexers; where a page depends on anything else (for example collection metadata), the page says so explicitly.
