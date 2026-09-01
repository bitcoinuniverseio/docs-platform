---
title: Developer overview
description: How to build against Bitcoin Universe APIs, schemas, and source repositories, and where each contract lives.
---

Bitcoin Universe development is contract-first: services and documentation are generated from the same interface contracts, so a documented endpoint and a running endpoint cannot silently diverge.

## Where interfaces live

The [interface directory](/developers/interfaces/) lists every API, schema, specification, and SDK the estate publishes, with the repository that owns it and the exact commit each link points at. It is derived from what repositories declare, so it shows real gaps rather than a tidy list.

| Interface | Contract form | Where |
| --- | --- | --- |
| Product REST APIs | OpenAPI 3.1 | Declared in each repository's `docs.manifest.json` under `contracts.openapi` |
| Event and WebSocket interfaces | AsyncAPI | Declared under `contracts.asyncapi` |
| Protocol payloads and data models | JSON Schema | Declared under `contracts.jsonSchema` |
| Indexer HTTP APIs | OpenAPI, route prefix `/<indexer-name>/` | The matching indexer repository |

Indexer API routes follow one convention across the estate: the route prefix is the indexer repository's name with its `index-` prefix removed. Example: the Patina indexer serves under `/patina/`.

## Ground rules for integrators

1. **Trust the contract, not example responses.** Examples are illustrative; the OpenAPI or AsyncAPI document is normative.
2. **Handle every availability state.** APIs distinguish `unavailable` from `empty` and `unknown` from zero. Treating a 5xx or an explicit unavailable state as "no results" corrupts downstream data. See [How to read our status](/status/).
3. **Respect stability badges.** Endpoints marked experimental can change without notice; deprecated endpoints name their replacement and removal window.
4. **Never send secrets.** No Universe API asks for seed phrases or private keys. Signing happens in your wallet, not on our servers.

## Repository map

- Product source and documentation repositories: see the [product catalog](/products/).
- Protocol specifications and vectors: see the [Protocol Atlas](/protocols/).
- Shared CI actions used by every repository: [universe-ci-actions](https://github.com/bitcoinuniverseio/universe-ci-actions).
- This portal itself: [docs-platform](https://github.com/bitcoinuniverseio/docs-platform). Its manifest schema, source pinning, and build tooling are public; documentation issues and content requests are welcome on any repository.
