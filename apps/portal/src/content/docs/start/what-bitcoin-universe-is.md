---
title: What Bitcoin Universe is
description: The products, protocols, and infrastructure Bitcoin Universe builds and operates, and how this documentation is organized.
---

Bitcoin Universe builds products for creating, owning, trading, and verifying digital artifacts on Bitcoin, Dogecoin, and Zcash, and operates the nodes and indexers those products read from. Production data comes from infrastructure we run ourselves, not from third-party data providers.

## The products

<div class="portal-product-table">
  <table>
    <thead>
      <tr><th scope="col">Product</th><th scope="col">What it does</th><th scope="col">Where</th></tr>
    </thead>
    <tbody>
      <tr><th scope="row">Core</th><td>Explorer, portfolio, and marketplace across every supported protocol</td><td><a href="https://bitcoinuniverse.io">bitcoinuniverse.io</a></td></tr>
      <tr><th scope="row">Inscribe</th><td>Creation studio for inscriptions, tokens, and mints</td><td><a href="https://inscribe.bitcoinuniverse.io">inscribe.bitcoinuniverse.io</a></td></tr>
      <tr><th scope="row">Wallet</th><td>Browser wallet for Bitcoin digital artifacts</td><td><a href="https://github.com/bitcoinuniverseio/docs-wallet">docs-wallet</a></td></tr>
      <tr><th scope="row">StampDEX</th><td>Trading venue for Bitcoin Stamps assets</td><td><a href="https://github.com/bitcoinuniverseio/docs-stampdex">docs-stampdex</a></td></tr>
      <tr><th scope="row">Zerdinals and Z-Runes</th><td>Digital-artifact record on Zcash</td><td><a href="https://zrunes.io">zrunes.io</a></td></tr>
      <tr><th scope="row">Forked Felines</th><td>Collection with on-chain artwork and provenance</td><td><a href="https://forked-felines.art">forked-felines.art</a></td></tr>
      <tr><th scope="row">Drops</th><td>Media-first artifacts using the OP_DROP carrier</td><td><a href="https://github.com/bitcoinuniverseio/drops-protocol-docs">drops-protocol-docs</a></td></tr>
    </tbody>
  </table>
</div>

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
