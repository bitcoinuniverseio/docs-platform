---
title: How to read our status
description: The fixed availability states used across every Bitcoin Universe product, API, and documentation page, and the rules behind them.
---

Every availability claim in Universe products and documentation uses the same small vocabulary. These states are load-bearing: products render them, APIs return them, and this documentation is validated against them.

## Component lifecycle

| State | Meaning |
| --- | --- |
| `stable` | Released, supported, safe to rely on. Breaking changes follow a deprecation window. |
| `beta` | Released for real use, still changing. |
| `experimental` | Exists and may run, but is not released for reliance. |
| `deprecated` | Still works; replacement named; removal window published. |
| `archived` | Frozen for reference, with a named replacement where one exists. |

## Data and service states

| State | Meaning |
| --- | --- |
| `healthy` | Serving current data within its freshness target. |
| `delayed` | Serving, but behind its freshness target. |
| `stale` | Serving old data beyond the tolerated window. |
| `degraded` | Partially serving. |
| `unavailable` | Not serving. Never rendered as an empty result. |
| `unsupported` | The capability does not exist for this chain, network, or version. |
| `unknown` | Cannot currently be determined. Never rendered as zero. |
| `empty` | Queried successfully; there is genuinely nothing. |

## The rules these states enforce

1. **Unavailable is never empty.** If a source is down, you see that the source is down, not a blank list.
2. **Unknown is never zero.** A balance we cannot read shows as unreadable, not as 0.
3. **Code presence is never availability.** A capability is claimed only when release evidence backs it: a released version, a capability manifest, and a validated contract.
4. **Freshness is measured, not asserted.** Live status cards derive from bounded public endpoints, and each shows when it last updated.

## Live status

Each product's documentation links its own live status sources. Public status endpoints are declared per repository in `docs.manifest.json` under `statusSources`, and the aggregated status experience on this portal is built only from those declared public endpoints.
