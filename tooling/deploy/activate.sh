#!/usr/bin/env bash
# Receives accepted bytes. Never rebuild or delete a served directory.
set -euo pipefail
SHA=${1:?full SHA required}
DIGEST=${2:?archive digest required}
[[ "$SHA" =~ ^[0-9a-f]{40}$ && "$DIGEST" =~ ^[0-9a-f]{64}$ ]]
RELEASES=/home/bitcoinuniverse/docs-releases
ARCHIVE="/tmp/docs-$SHA-$DIGEST.tgz"
DEST="$RELEASES/$SHA-$DIGEST"
mkdir -p "$RELEASES"
exec 9>"$RELEASES/.activation.lock"
flock 9
echo "$DIGEST  $ARCHIVE" | sha256sum --check --status
if [ -d "$DEST" ]; then
  (cd "$DEST" && sha256sum --check --status CHECKSUMS.sha256)
else
  INCOMING=$(mktemp -d "$RELEASES/.incoming-$SHA-XXXXXX")
  trap 'rm -rf -- "$INCOMING"' EXIT
  tar -xzf "$ARCHIVE" -C "$INCOMING"
  (cd "$INCOMING" && sha256sum --check --status CHECKSUMS.sha256)
  test -f "$INCOMING/index.html"
  test -f "$INCOMING/pagefind/pagefind.js"
  test -f "$INCOMING/sitemap-index.xml"
  test "$(cat "$INCOMING/RELEASE")" = "$SHA"
  chown -R bitcoinuniverse:bitcoinuniverse "$INCOMING"
  mv "$INCOMING" "$DEST"
  trap - EXIT
fi
test "$(cat "$DEST/RELEASE")" = "$SHA"
PREVIOUS=$(readlink "$RELEASES/current" || true)
if [ "$PREVIOUS" != "$DEST" ]; then
  ln -sfn "$DEST" "$RELEASES/current.new"
  mv -Tf "$RELEASES/current.new" "$RELEASES/current"
  printf '%s\n' "$PREVIOUS" > "$RELEASES/PREVIOUS"
fi
rm -f -- "$ARCHIVE"
# Retention is separate; never prune current or PREVIOUS here.
