#!/usr/bin/env bash
# Target and accepted run are resolved by the protected production workflow.
set -euo pipefail
: "${TARGET_SHA:?explicit rollback target SHA required}"
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]]
export ROLLBACK=true
exec bash tooling/deploy/deploy.sh
