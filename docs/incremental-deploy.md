# Incremental documentation deployment

Implemented locally on `fix/incremental-deploy-20261024`, based on refreshed
`origin/develop` = `840601dfff19b660b9693942e89c0cd328fc209a`.
No push, dispatch, publication, rollback, SSH connection or runner change was
performed. Operational acceptance remains pending.

## Scope and validation

`tooling/deploy/scope.mjs` reads the exact live identity from
`https://dev.docs.bitcoinuniverse.io/universe-dev-release.txt` or
`https://docs.bitcoinuniverse.io/RELEASE`. It validates a full 40-hex Git commit
and fetches that object if necessary. Unknown/unavailable markers fall back to
HEAD~1 with a diagnostic; initial commits compare against the empty tree.
This changes the base only, never substitutes full tests. Checkout fetches full
history. Diff parsing uses NUL-delimited status/filenames and rename detection;
filenames never become shell expressions. Deleted/renamed routes, changed slugs
and removed registry IDs are recorded separately and checked for HTTP 404.

`scope.json` records base, target SHA, files, pins, packages, routes, coverage,
tests, supported type projects and builds. Its `mapping` records each change's
pins/packages/routes/tests/builds. The scope is embedded in `accepted.json` with
the configuration, original run and immutable archive digest.

| Input | Selected validation | Routes |
| --- | --- | --- |
| Repository README/prose, unused services | Skip install/build/publication | None |
| Published portal MD/MDX | Changed-file style lint; portal build | Exact page, honoring slug |
| Static Astro page | Changed-file style lint; portal build | Exact page |
| Shared component/layout/style/config/dynamic template | Relevant lint/syntax; portal build | Template smoke below |
| Product/protocol registry | Explicit registry Node tests | Added/modified IDs, deleted IDs checked 404, template smoke |
| Imported design system | Source lint/syntax; portal build | Template smoke |
| Content schema | Explicit schema/registry tests; incremental schema tsc | Template smoke |
| Source lock/sync registry | Entry subset verification, removal consistency, sync/subset tests | Linked product/protocol IDs plus template smoke |
| Deployment scripts/workflows | Explicit deployment fixtures; changed JS syntax | Template smoke |
| Dependency/workspace/toolchain/manifests/patches | Explicit portal-related Node tests; supported incremental tsc | Template smoke |

Source pins compare entries, including additions/removals/sourceRef changes.
`sync.mjs verify --pins-file <JSON-array-file>` verifies named entries only,
rejecting malformed/missing selected pins and invalid lock/registry structure.
An explicit empty array makes no network requests. Deployment skips the command
entirely without changed pins. Default `verify` still verifies all pins. Removed
pins must disappear from both registry and lock.

The portal directly imports design-system and ecosystem-registry source exports;
neither has a build script. There is no Turbo installation. Unused services and
inscribe-learning are not built. The current Astro build does not fetch external
source repositories: generated portal content and committed registry snapshots
are the rendered inputs. Source metadata remains a shipping/invalidation input.

Supported affected portal/schema TS projects use `tsc --noEmit --incremental`
with cached build information; portal TS changes first run `astro sync` for
declarations. Deployment never calls `astro check` or a workspace typecheck
wrapper. Full Astro template/type validation remains in PR CI. Empty selections
skip their commands.

## Accessibility coverage

One content edit audits that page. Shared changes select at most twelve
representatives before adding explicitly changed content/data entries:
`/`, `/start/safety/`, `/ask/`, `/chains/`, `/changelog/`,
`/developers/interfaces/`, `/products/`, `/protocols/`, `/status/live/`,
`/status/documentation-health/`, and the first current product/protocol detail ID.
This is representative template smoke, not exhaustive coverage. Every changed
registry ID is added even when it is not the representative ID.

Empty routes skip browser restoration/setup and the audit command. The checker
also exits explicitly for an empty `--routes`; omitting the flag still audits
every page. All axe rules, phone/desktop widths (375/1440), light/dark themes and
overflow checks remain unchanged. CI retains workspace tests/typechecking,
all-page auditing and link validation, with added deployment fixtures. Existing
security/audit policy, required checks and visual baselines are preserved. CI's
existing legacy selector was not copied into deployment or recovery.

## Cache design

All cache paths are app-specific under `.cache/docs-deploy`, separate from
My-Clone-AI. Dependency keys include OS/architecture, Node 24.19.0, pnpm 10.34.5,
lockfile, every workspace manifest, patches and relevant workspace/toolchain
configuration. Even on a store hit, frozen `--prefer-offline` installation links
a valid workspace node_modules tree. A store is never treated as an installation.

Astro generated state and supported TS build information use evolving keys with
restore prefixes. A small whole-portal output task cache also records a complete
file checksum inventory. Its exact key includes tracked shipping bytes, source
content/pins, imported packages, dependencies/configuration, Node/platform/arch,
SITE_URL/BASE_PATH and content Git history used by lastUpdated. A restored tree
must match the exact key and every checksum. Otherwise only the portal rebuilds.
Changed inputs normally require Astro's complete render: this does not implement
incremental page rendering. Identical input graphs actually skip rendering.
There is no claim that `.vite` makes production rendering incremental.

Chromium keys explicitly include platform, installed Playwright version and
Chromium revision plus lock/package fingerprints. The inspected workspace pins
Playwright 1.62.1 and Chromium revision 1234. Only the installed workspace
executable downloads Chromium, only with selected routes. No unpinned npx,
`--with-deps` or system-package installation is used.

## Orders, artifacts and recovery

Production has no push trigger. Normal publication requires workflow_dispatch
on main, exact `confirm=DEPLOY-PRODUCTION` and the protected production environment.
The reusable publisher repeats the event/branch/confirmation gate before checkout
or credentials. Dev stays develop-only with cancel-in-progress true. Dev shipping
filters cover published content, imports, sources/sync, dependencies/configuration,
helpers and workflows. Runtime scope confirmation precedes installation.

Preparation validates build/link integrity, search, sitemap and assets, audits
selected routes, writes SHA markers and checksums, and uploads one immutable
accepted archive. Publication validates GitHub's artifact ZIP digest, original
run/repository/workflow/branch, successful preparation, accepted SHA/configuration
and archive digest. A durable publication intent is uploaded before SSH.
Recovery never executes downloaded application code.

Live verification asserts exact marker SHA, index/referenced assets, search,
sitemap, selected pages and removals. Before repeating ambiguous publication it
checks identity and health. Production verifies the archive and extracted file
checksums, then atomically activates `<sha>-<digest>`. Existing directories are
verified rather than deleted on retry. Current and PREVIOUS targets are retained;
retention is a separate operator task. Health failure surfaces without automatic
rollback.

Manual redeploy uses a successful original `artifact_run` on the same current
branch/SHA, with DEPLOY-PRODUCTION for production. It runs no preparation suites.
Rollback is separate: main workflow_dispatch, `confirm=ROLLBACK-PRODUCTION`, full
`rollback_to` and its successful original `artifact_run`. It consumes those bytes
and verifies RELEASE against the rollback target, not workflow HEAD. Missing or
expired artifacts fail closed instead of rebuilding HEAD. Retention is 30 days.

One automatic retry uses an independent workflow_run recovery workflow with
trusted default-branch helpers and runners-4. It validates publication intent,
original repository/workflow/branch/SHA, attempt=1, successful accepted preparation,
artifact IDs/digests, current branch head and classified evidence. Only confirmed
SSH reset, verification transport timeout, or GitHub's runner-communication-loss
annotation qualify. Surviving classified fatal evidence overrides runner-loss
inference. Authentication/checksum/validation/health errors, cancellations,
superseded SHAs, rerun attempts and rollback orders never authorize automatic
retry. Recovery cannot trigger itself and shares the publication concurrency
lock. It runs no install, build, tests, full audit or all-source verification.

SSH requires StrictHostKeyChecking=yes and pinned known_hosts. Dev retains the
universe-dev `deploy docs <sha>` forced command and existing pinned host key.
Production requires protected DOCS_KNOWN_HOSTS verified out of band, DOCS_HOST,
and existing DOCS_DEPLOY_KEY or DOCS_DEPLOY_PASSWORD. Temporary auth files are
mode-restricted and removed in finally. No unauthenticated key discovery is used.
Coordinator must verify that the existing dev forced receiver preserves atomic,
idempotent activation, extracted checksums and the currently served directory;
connecting to or changing that host was prohibited in this task.

## Local evidence

All commands ran in the dedicated worktree with Node 24.19.0. The pinned pnpm
CLI and checksum-verified actionlint 1.7.12 were installed only under ignored
`.tmp/tools`. No global installation or service change occurred.

| Command/check | Result |
| --- | --- |
| git status; git fetch origin develop; git rev-parse origin/develop | Clean start; successful refresh; base above |
| node --test tooling/deploy/test/*.test.mjs tooling/sync/test/subset.test.mjs | 22 focused deployment/route/cache/retry and subset fixtures pass |
| node tooling/sync/test/sync.test.mjs | Existing sync assertions pass |
| sync.mjs verify --pins-file with explicit [] fixture | Verified zero pins, no remote validation |
| pinned pnpm install --frozen-lockfile --prefer-offline --store-dir .cache/docs-deploy/pnpm-store | 446 packages linked, 37.3s, lock unchanged |
| pinned pnpm install --frozen-lockfile --offline against same store | Valid warm install, 1.2s |
| pinned pnpm --filter @universe/docs-portal build | Pass; 67 pages; internal links, Pagefind and sitemap valid |
| pinned pnpm --filter @universe/docs-portal exec tsc --noEmit --incremental --tsBuildInfoFile <worktree>/.cache/docs-deploy/portal.tsbuildinfo | Pass |
| prepare.mjs build twice, cache seeded from the real build | Reuse=true both times, 1.825s / 1.293s wall; no Astro/pnpm subprocess |
| Explicit empty --routes against nonexistent dist | Exits before discovery/browser startup |
| actionlint -shellcheck= -pyflakes= on five deployment workflows | Pass with runners-4 label declared |
| CI actionlint with only existing legacy-label diagnostic ignored | Pass; CI selector unchanged |
| bash -n activate/deploy/rollback; node --check changed JS; git diff --check | Pass |

Cache fixtures prove changed keys and corrupt bytes reject reuse. Retry fixtures
consume identical archive bytes without preparation callbacks; activation retains
existing verified destinations. The portal build reported 11.01s after cold
startup, with existing markdown-plugin deprecation and 404 precedence warnings.
Local cache timings are not runners-4 release measurements. No full workspace
suites were run locally.

## Historical timing and operational acceptance

Supplied historical baselines: dev around 1.5 minutes; production 3 to 80 minutes
with frequent failures. These are historical, not after-change measurements.
Existing Actions run/job records were retrieved read-only. Raw log downloads
returned HTTP 403, so cache warmth cannot be certified.

| Sample | Existing run | Trigger to observed result | Qualification |
| --- | --- | --- | --- |
| Dev before 1 | [39785575955](https://github.com/bitcoinuniverseio/docs-platform/actions/runs/39785575955) | 89s to marker verification, 103s workflow total | Success; warmth unverified |
| Dev before 2 | [39586239113](https://github.com/bitcoinuniverseio/docs-platform/actions/runs/39586239113) | 32s to marker verification, 37s workflow total | Success; warmth unverified |
| Production before 1 | [34009898401](https://github.com/bitcoinuniverseio/docs-platform/actions/runs/34009898401) | 763s workflow total | Success; old final report lacked expected-SHA assertion; warmth unverified |
| Production before 2 | [33704125568](https://github.com/bitcoinuniverseio/docs-platform/actions/runs/33704125568) | 284s workflow total | Same qualification |
| Production failure | [39785575797](https://github.com/bitcoinuniverseio/docs-platform/actions/runs/39785575797) | 159s to failed a11y; initial job queue 38s | No verified release |
| Production queue failure | [36243882194](https://github.com/bitcoinuniverseio/docs-platform/actions/runs/36243882194) | 3002s to failed publication; 2397s before job start; a11y 430s | No verified release |
| Dev after warm 1 / 2 | PENDING / PENDING | PENDING / PENDING | Coordinator live acceptance |
| Production after warm 1 / 2 | PENDING / PENDING | PENDING / PENDING | Coordinator live acceptance |

Success summaries record original order/event created_at, run_started_at, job
timestamps, queue waits, build/output reuse, publication duration, verified-live
time and deploy_seconds. Recovery includes original queue/build and recovery
scheduling in the original order-to-live interval. Redeploy/rollback clocks start
at their new order, not the old artifact's creation. Warn above 300 seconds.
Historical failures are not verified-live durations.

Coordinator prerequisites: protected production environment and verified host pin;
dev receiver guarantees; Linux runners-4 browser libraries; pinned toolchain;
unzip/tar/OpenSSH and server flock/sha256sum; artifact access/digest support;
recovery workflow installed on trusted default branch. Confirm two warm before
samples using retained operator logs, then collect two warm after runs per
workflow under a separately authorized live order. The <=300s target is unproven
until then. Keep the shared eight-runner cap. Reserving a future lane requires
cap-guard provisioning AND CI exclusion; labels alone do not reserve capacity.
No runner 6467, My-Clone-AI runner, service or fleet configuration was touched.

Universe Memory tools and a codebase index were unavailable. Current worktree,
refreshed Git state and direct import/source inspection were used. This document
is the durable handoff pending coordinator memory ingestion.
