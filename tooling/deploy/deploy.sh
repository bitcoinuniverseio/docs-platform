#!/usr/bin/env bash
# Deploy a built portal to the documentation host, atomically.
#
#   deploy.sh <dist-dir> <commit-sha>
#
# Releases live at $RELEASES/<commit-sha>. The live site is whatever
# $RELEASES/current points at, so the swap is a single symlink write and a
# reader either sees the whole old release or the whole new one. Rollback is
# the same swap pointed backwards, which is why old releases are kept.
#
# Required environment:
#   DOCS_HOST        ssh target, for example root@example
#   DOCS_SSH_KEY     path to the private key, or
#   DOCS_PASSWORD    password supplied through a protected secret
# Optional:
#   RELEASES         release root (default /home/bitcoinuniverse/docs-releases)
#   KEEP             releases to retain (default 5)

set -euo pipefail

DIST=${1:?usage: deploy.sh <dist-dir> <commit-sha>}
SHA=${2:?usage: deploy.sh <dist-dir> <commit-sha>}
RELEASES=${RELEASES:-/home/bitcoinuniverse/docs-releases}
KEEP=${KEEP:-5}
: "${DOCS_HOST:?DOCS_HOST is required}"
DOCS_SSH_KEY=${DOCS_SSH_KEY:-}
DOCS_PASSWORD=${DOCS_PASSWORD:-}

SSH=(ssh)
SCP=(scp)
if [ -f "$DOCS_SSH_KEY" ]; then
  SSH+=(-i "$DOCS_SSH_KEY")
  SCP+=(-i "$DOCS_SSH_KEY")
elif [ -n "$DOCS_PASSWORD" ]; then
  if [ -z "${SSH_ASKPASS:-}" ] || [ ! -x "$SSH_ASKPASS" ]; then
    echo "an executable SSH_ASKPASS helper is required for password authentication" >&2
    exit 2
  fi
  export SSH_ASKPASS
  export SSH_ASKPASS_REQUIRE=force
  export DISPLAY=${DISPLAY:-docs-deploy}
  SSH=(ssh -o BatchMode=no -o NumberOfPasswordPrompts=1)
  SCP=(scp -o BatchMode=no -o NumberOfPasswordPrompts=1)
else
  echo "DOCS_SSH_KEY or DOCS_PASSWORD is required" >&2
  exit 2
fi
SSH+=(-o StrictHostKeyChecking=accept-new)
SCP+=(-o StrictHostKeyChecking=accept-new)

if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "commit must be a full 40-hex sha, got: $SHA" >&2
  exit 2
fi
if [[ ! -f "$DIST/index.html" ]]; then
  echo "no index.html in $DIST; refusing to deploy an empty build" >&2
  exit 2
fi

echo "$SHA" > "$DIST/RELEASE"
TAR=$(mktemp -t portal-XXXXXX.tgz)
trap 'rm -f "$TAR"' EXIT
tar -C "$DIST" -czf "$TAR" .

echo "uploading $(du -h "$TAR" | cut -f1) for $SHA"
"${SCP[@]}" "$TAR" "$DOCS_HOST:/tmp/portal-$SHA.tgz"

# shellcheck disable=SC2087
"${SSH[@]}" "$DOCS_HOST" bash -s <<EOF
set -euo pipefail
RELEASES="$RELEASES"
SHA="$SHA"
KEEP="$KEEP"

mkdir -p "\$RELEASES"
rm -rf "\$RELEASES/\$SHA.incoming"
mkdir -p "\$RELEASES/\$SHA.incoming"
tar -xzf /tmp/portal-\$SHA.tgz -C "\$RELEASES/\$SHA.incoming"
rm -f /tmp/portal-\$SHA.tgz

test -f "\$RELEASES/\$SHA.incoming/index.html"
test "\$(cat "\$RELEASES/\$SHA.incoming/RELEASE")" = "\$SHA"

rm -rf "\$RELEASES/\$SHA"
mv "\$RELEASES/\$SHA.incoming" "\$RELEASES/\$SHA"
chown -R bitcoinuniverse:bitcoinuniverse "\$RELEASES/\$SHA"

PREVIOUS=\$(readlink "\$RELEASES/current" 2>/dev/null || echo none)
ln -sfn "\$RELEASES/\$SHA" "\$RELEASES/current.new"
mv -Tf "\$RELEASES/current.new" "\$RELEASES/current"
echo "\$PREVIOUS" > "\$RELEASES/PREVIOUS"
echo "swapped: \$PREVIOUS -> \$RELEASES/\$SHA"

# Keep the most recent releases so a rollback always has somewhere to go.
cd "\$RELEASES"
ls -1dt [0-9a-f]* 2>/dev/null | tail -n +\$((KEEP + 1)) | while read -r old; do
  [ "\$old" = "\$SHA" ] && continue
  rm -rf "\$old" && echo "pruned \$old"
done
EOF

echo "verifying"
for path in / /protocols/ /pagefind/pagefind.js /RELEASE; do
  code=$("${SSH[@]}" "$DOCS_HOST" "curl -s -o /dev/null -w '%{http_code}' -H 'Host: docs.bitcoinuniverse.io' http://127.0.0.1$path")
  echo "  $path -> $code"
  if [ "$code" != "200" ]; then
    echo "verification failed on $path; roll back with tooling/deploy/rollback.sh" >&2
    exit 1
  fi
done

live=$("${SSH[@]}" "$DOCS_HOST" "curl -s -H 'Host: docs.bitcoinuniverse.io' http://127.0.0.1/RELEASE")
if [ "$live" != "$SHA" ]; then
  echo "live release is $live, expected $SHA" >&2
  exit 1
fi
echo "deployed $SHA"
