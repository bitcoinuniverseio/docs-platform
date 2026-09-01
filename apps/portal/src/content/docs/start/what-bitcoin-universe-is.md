---
title: What Bitcoin Universe is
description: The products, protocols, and infrastructure Bitcoin Universe builds and operates, and how this documentation is organized.
---

Bitcoin Universe builds products for creating, owning, trading, and verifying digital artifacts on Bitcoin, Dogecoin, and Zcash, and operates the nodes and indexers those products read from. Production data comes from infrastructure we run ourselves, not from third-party data providers.

## The products

| Product | What it does | Where |
| --- | --- | --- |
| **Core** | Explorer, portfolio, and marketplace across every supported protocol | [bitcoinuniverse.io](https://bitcoinuniverse.io) |
| **Inscribe** | Creation studio for inscriptions, tokens, and mints | [inscribe.bitcoinuniverse.io](https://inscribe.bitcoinuniverse.io) |
| **Wallet** | Browser wallet for Bitcoin digital artifacts | [docs-wallet](https://github.com/bitcoinuniverseio/docs-wallet) |
| **StampDEX** | Trading venue for Bitcoin Stamps assets | [docs-stampdex](https://github.com/bitcoinuniverseio/docs-stampdex) |
| **Zerdinals and Z-Runes** | Digital-artifact record on Zcash | [zrunes.io](https://zrunes.io) |
| **Forked Felines** | Collection with on-chain artwork and provenance | [forked-felines.art](https://forked-felines.art) |
| **Drops** | Media-first artifacts using the OP_DROP carrier | [drops-protocol-docs](https://github.com/bitcoinuniverseio/drops-protocol-docs) |

## The protocols

Universe products speak many protocols: inscription-based families (Ordinals, BRC-20, TAP), OP_RETURN-based families (Runes, SRC-20, SRC-101, DUST-20), the OP_DROP carrier, and more. The [Protocol Atlas](/protocols/) holds one dossier per protocol: its specification, carrier, operations, examples, and indexer semantics.

## How this documentation works

- **Each repository owns its content.** Every public repository declares a `docs.manifest.json`; this portal builds from exact pinned commits, never from a moving branch.
- **Claims trace to releases.** A capability appears as available only when release evidence says so. Code existing in a repository is not availability.
- **Status is explicit.** Availability language uses fixed states (healthy, delayed, stale, degraded, unavailable, unsupported, unknown, empty). An unavailable service is never shown as an empty result. See [How to read our status](/status/).

## Where to go next

- New here: [Safety in sixty seconds](/start/safety/), then [Choose your path](/start/choose-your-path/).
- Building something: [Developer overview](/developers/).
- Checking a claim: [Source provenance](/status/provenance/).
