# Repository health log: docs-platform

Process incidents and the rules adopted because of them. Newest first. Times are Asia/Jerusalem.

## 2026-11-11: PR #44 merged with cancelled PR CI (process breach)

- **What happened.** PR #44 (`grow/push-20261111T1045-docs-ci-scoped-root-wrapper-r3`, "scoped CI deploy wrapper") was merged into `develop` at 16:57 Asia/Jerusalem on 2026-11-11 (merge commit aab5e5b9), as `bitcoinuniverseadmin`, by the OpenBot Universe docs auto-deploy agent (`agent-614c7ff8-5a4d-4b36-8f3d-ca0e0b2fa7bf` on inference-and-runners-universe). Its PR CI run [43033186084](https://github.com/bitcoinuniverseio/docs-platform/actions/runs/43033186084) had been **cancelled** in the accessibility step and was never green. The agent cited a local pass of the accessibility gate instead of the PR CI.
- **Consequence.** `develop` was promoted to `main` two minutes later (df854b1a). Production deployed fine ([43043832436](https://github.com/bitcoinuniverseio/docs-platform/actions/runs/43043832436)), but `main` CI [43043832639](https://github.com/bitcoinuniverseio/docs-platform/actions/runs/43043832639) then failed in "Accessibility and sideways scroll, every page, both themes": `page.goto: Timeout 30000ms exceeded` on `/ask/`, on a CPU-starved shared runner (universe-31). This is the same slow accessibility step that had kept the PR CI from finishing.
- **Classification.** Process breach. A cancelled, skipped, pending or failed CI is not a pass, and a local run is not a substitute for PR CI.
- **Follow-up.** Back-merge of `main` into `develop` (#45). Accessibility gate made robust against slow runners in a separate PR. Merge rule added to the merging agent's `AGENTS.md`.

### Rule from now on

**No merge without a green PR CI.** Never merge a PR unless all its required PR CI checks completed successfully. Cancelled, skipped, pending or failed CI means do not merge. This applies to every agent and human, including admin merges, and to `develop` as well as `main`. Promotion to `main` (production) needs Miguel's explicit order.
