# Deploying the portal

See [incremental deployment](../../docs/incremental-deploy.md) for scope,
checks, caches, artifact provenance, retry policy and operational acceptance.

Production requires an explicit order on main, exact confirmation and the
protected production environment. Main pushes cannot publish. Dev publication
remains develop-only through the existing universe-dev SSH forced command.

The workflows prepare a checksum-bound immutable archive once. Publication,
manual redeployment and recovery consume that archive without installation,
building or testing. `deploy.sh` now accepts the `accepted/` artifact directory
and workflow-provided provenance, never an arbitrary dist tree.

Production activation stores `<sha>-<archive-sha256>` under
`/home/bitcoinuniverse/docs-releases`, verifies the archive and extracted checksums,
and atomically swaps `current`. Repeating the same archive verifies the existing
directory rather than deleting it. `PREVIOUS` records the previous activation;
publication never prunes current or previous releases. Retention must be managed
separately without deleting either pointer's target.

Rollback requires `ROLLBACK-PRODUCTION`, a full `rollback_to` SHA and the original
successful `artifact_run`. It republishes those accepted bytes and verifies
`RELEASE` against that target, independently of the workflow's HEAD SHA.
