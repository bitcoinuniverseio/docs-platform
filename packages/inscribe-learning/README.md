# @universe/inscribe-learning

The deterministic learning core for Inscribe documentation. One source of truth shared by the public documentation site, the Inscribe application, and the documentation MCP.

Pure, browser-safe logic only: no React, no secrets, no network access, no wallet calls, no mutation of any kind.

## What is inside

- **Schemas** (`valibot 1.x`) for the learning manifest, planner input, deep-link intents, and guide progress. Every value crossing a trust boundary is validated with these.
- **Guided planner engine**: deterministic, explainable workflow selection with per-workflow exclusion reasons and a score breakdown that names the rule behind every point.
- **Protocol comparison**: source-backed dimension rows, match and partial-match explanations, and exclusion reasons. Cells the sources do not establish render as unestablished, never invented.
- **Recovery state machine**: walks the recovery decision table, audits it for loops, unreachable questions, and dead ends, and terminates every branch in a manifest outcome.
- **Safe deep links**: a builder that accepts only validated, non-sensitive fields and refuses addresses, transaction ids, outpoints, PSBT material, and unapproved return origins. A generated link can open a workspace and prefill safe options; it can never create an order, connect a wallet, sign, pay, or broadcast.
- **Guide progress**: version 2 progress keyed by stable step IDs, migration from the version 1 index format, lossless merge, and the Learning Passport export/import text format with checksum.
- **Estimation primitives**: the pure Inscribe estimator, ported verbatim so one formula serves the app, the documentation, and the MCP tools. Estimates always state that the final in-app quote is authoritative.
- **The generated learning manifest** (`data/inscribe-learning.manifest.json`) with exact source commits for the inscribe, docs-platform, and docs-inscribe repositories.

## The three availability dimensions

The contract never collapses capability into one "available" boolean:

1. **Implemented** in code at the source commit.
2. **Enabled** by the current production deployment.
3. **Healthy** right now, resolved at runtime from the live sources named in `healthDependencies`. An unreachable source resolves to `unknown`, never to healthy and never to a blank value.

## Distribution

The package is vendored into consumers as a deterministic archive. The packer writes fixed ustar metadata and a hand-built gzip header, so identical inputs produce identical bytes on every platform. Consumer CI regenerates the archive from the declared source commit and byte-compares it against the vendored copy.

Regenerate and pack from a checkout of this repository:

```sh
pnpm install
pnpm build
pnpm test
node bin/pack-deterministic.mjs
```

## Regenerating the manifest

The manifest is generated from authoritative sources; it is never hand-edited.

```sh
node bin/generate-learning-manifest.mjs \
  --inscribe <path-to-inscribe-checkout> \
  --docs-platform <path-to-docs-platform-checkout> \
  --docs-inscribe <path-to-docs-inscribe-checkout> \
  --out <path-to-output.json>
```

The generator proves cross references before writing: workspaces exist in the app route list, walkthrough and scenario ids resolve, recovery outcomes reference real guides, the decision table has no loops or unreachable nodes, every actionable workflow resolves to a planner path, and every workflow intent round-trips through the safe link builder. Any broken reference fails the run instead of shipping.

Pin `--generated-at` for reproducible output when the content is unchanged.
