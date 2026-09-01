# Deploying the portal

The live site is whatever `docs-releases/current` points at. Deploying is a
single symlink write, so a reader sees either the whole old release or the
whole new one, and rolling back is the same write pointed backwards.

```
docs-releases/
  <commit-sha>/        one release, named by the exact commit that built it
  <commit-sha>/        previous releases, retained so rollback has a target
  current -> <sha>     the live site
  PREVIOUS             what current pointed at before the last swap
```

The document root is itself a symlink to `current`. Every release ships a
`RELEASE` file naming its commit, so the live site can always be asked what it
is serving:

```bash
curl https://docs.bitcoinuniverse.io/RELEASE
```

## From CI

`.github/workflows/deploy.yml` runs on every push to `main`. It verifies the
pinned sources still validate, builds the portal, runs the accessibility gate,
and only then deploys the exact commit that passed. Production never publishes
from a working tree or from an arbitrary branch.

To roll back, run the workflow manually with `rollback_to` set to a retained
commit.

## By hand

Both scripts need an SSH target and either a key or a protected password:

```bash
export DOCS_HOST=root@<documentation-host>
export DOCS_SSH_KEY=~/.ssh/<key>

bash tooling/deploy/deploy.sh apps/portal/dist "$(git rev-parse HEAD)"
bash tooling/deploy/rollback.sh                 # to the previous release
bash tooling/deploy/rollback.sh <commit-sha>    # to a specific one
```

`deploy.sh` refuses a short or non-hex commit, refuses a build with no
`index.html`, verifies the extracted tree on the host before it can go live,
and checks the site after the swap. A failed verification leaves the previous
release serving.

`KEEP` controls how many releases are retained (default 5). Rollback can only
reach a retained release, so lowering it shortens how far back you can go.

## Required secrets

The deploy workflow reads these protected production environment secrets:

| Secret | What it is |
| --- | --- |
| `DOCS_HOST` | ssh target for the documentation host, as `user@host` |
| `DOCS_DEPLOY_KEY` | private key authorised for that target |
| `DOCS_DEPLOY_PASSWORD` | existing target password, used only when no deploy key is configured |

Use a key scoped to this deployment rather than a shared administrative key,
and give it write access to the release directory and nothing else. The
workflow writes the key to the runner, uses it, and removes it in an `always`
step so it does not survive the job. Password authentication is supported for
an existing credential when a scoped key is not available; the password stays
in the protected production environment and is supplied through OpenSSH's
temporary askpass helper, never the command line. The helper is mode 700 and is
removed in the workflow's unconditional cleanup step.
