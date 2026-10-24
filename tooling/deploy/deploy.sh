#!/usr/bin/env bash
# Consume the already accepted artifact. No build or validation suites here.
set -euo pipefail
test -f accepted/accepted.json
test -f accepted/portal.tgz
exec node tooling/deploy/publish.mjs
