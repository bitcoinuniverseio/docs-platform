---
title: Source provenance
description: How every page on this portal records exactly where its content came from, and how to verify it yourself.
---

This portal never publishes content from a moving branch. Everything you read here traces to an exact commit in a public repository, and you can verify the chain yourself.

## The provenance chain

1. **Each repository declares its documentation** in a root `docs.manifest.json`, validated against the [public schema](https://github.com/bitcoinuniverseio/docs-platform/blob/develop/packages/content-schema/schemas/docs.manifest.schema.json). The manifest records the repository's identity, lifecycle, chains, contracts, owners, and the commit at which a maintainer last verified it.
2. **The portal pins every source** in [`sources.lock.json`](https://github.com/bitcoinuniverseio/docs-platform/blob/develop/sources.lock.json): one exact 40-character commit SHA per repository, plus the SHA-256 hash of the manifest at that commit. A build uses only those commits.
3. **Updates arrive as pull requests.** When a source repository releases or changes its documentation, an automated pull request updates the lock. Nothing reaches the portal without that reviewed, recorded step.

## Verifying a claim

To check any statement on this portal:

1. Find the source repository (linked from the page or catalogued in the [product catalog](/products/) and [Protocol Atlas](/protocols/)).
2. Open `sources.lock.json` in [docs-platform](https://github.com/bitcoinuniverseio/docs-platform) and note the pinned commit for that repository.
3. Read the source file at exactly that commit on GitHub. If the portal says something the pinned source does not say, that is a bug; [report it](https://github.com/bitcoinuniverseio/.github/blob/main/SUPPORT.md).

## Operator labeling

Every data source in Universe products is labeled as Universe-operated or third-party. Production blockchain data comes from Universe-operated nodes and indexers; where a page depends on anything else (for example collection metadata), the page says so explicitly.
