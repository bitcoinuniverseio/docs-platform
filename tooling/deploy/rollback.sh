#!/usr/bin/env bash
# Roll the live documentation site back to a previous release.
#
#   rollback.sh            roll back to whatever was live before the last deploy
#   rollback.sh <sha>      roll back to a specific retained release
#
# Same mechanism as deploy: one symlink swap. Requires DOCS_HOST and either
# DOCS_SSH_KEY or DOCS_PASSWORD, and honours RELEASES.

set -euo pipefail

TARGET=${1:-}
RELEASES=${RELEASES:-/home/bitcoinuniverse/docs-releases}
: "${DOCS_HOST:?DOCS_HOST is required}"
DOCS_SSH_KEY=${DOCS_SSH_KEY:-}
DOCS_PASSWORD=${DOCS_PASSWORD:-}

SSH=(ssh)
if [ -f "$DOCS_SSH_KEY" ]; then
  SSH+=(-i "$DOCS_SSH_KEY")
elif [ -n "$DOCS_PASSWORD" ]; then
  if [ -z "${SSH_ASKPASS:-}" ] || [ ! -x "$SSH_ASKPASS" ]; then
    echo "an executable SSH_ASKPASS helper is required for password authentication" >&2
    exit 2
  fi
  export SSH_ASKPASS
  export SSH_ASKPASS_REQUIRE=force
  export DISPLAY=${DISPLAY:-docs-deploy}
  SSH=(ssh -o BatchMode=no -o NumberOfPasswordPrompts=1)
else
  echo "DOCS_SSH_KEY or DOCS_PASSWORD is required" >&2
  exit 2
fi
SSH+=(-o StrictHostKeyChecking=accept-new)

# shellcheck disable=SC2087
"${SSH[@]}" "$DOCS_HOST" bash -s <<EOF
set -euo pipefail
RELEASES="$RELEASES"
TARGET="$TARGET"

if [ -z "\$TARGET" ]; then
  PREV=\$(cat "\$RELEASES/PREVIOUS" 2>/dev/null || echo none)
  if [ "\$PREV" = "none" ] || [ ! -d "\$PREV" ]; then
    echo "no previous release recorded; pass a commit sha explicitly" >&2
    echo "retained releases:" >&2
    ls -1dt "\$RELEASES"/[0-9a-f]* 2>/dev/null | head -10 >&2
    exit 1
  fi
  DEST="\$PREV"
else
  DEST="\$RELEASES/\$TARGET"
  if [ ! -d "\$DEST" ]; then
    echo "release \$TARGET is not retained on this host" >&2
    ls -1dt "\$RELEASES"/[0-9a-f]* 2>/dev/null | head -10 >&2
    exit 1
  fi
fi

test -f "\$DEST/index.html"
CURRENT=\$(readlink "\$RELEASES/current" 2>/dev/null || echo none)
ln -sfn "\$DEST" "\$RELEASES/current.new"
mv -Tf "\$RELEASES/current.new" "\$RELEASES/current"
echo "\$CURRENT" > "\$RELEASES/PREVIOUS"
echo "rolled back: \$CURRENT -> \$DEST"
curl -s -o /dev/null -w "live status %{http_code}\n" -H 'Host: docs.bitcoinuniverse.io' http://127.0.0.1/
echo "live release \$(curl -s -H 'Host: docs.bitcoinuniverse.io' http://127.0.0.1/RELEASE)"
EOF
