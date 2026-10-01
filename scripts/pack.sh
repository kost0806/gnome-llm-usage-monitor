#!/usr/bin/env bash
# Build dist/ai-usage@local-<version>.shell-extension.zip (same layout as `gnome-extensions pack`).
# $1: version label, e.g. 0.1.1 or dev-4cc8687. Written into metadata.json as "version-name"
#     and into the file name. `gnome-extensions install` reads the UUID from metadata.json,
#     so the versioned file name does not affect installation.
# Prints the path of the built zip.
set -euo pipefail

if [ $# -ne 1 ] || [ -z "$1" ]; then
    echo "usage: $0 <version>" >&2
    exit 2
fi

VERSION="$1"
UUID=ai-usage@local
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/$UUID-$VERSION.shell-extension.zip"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp -r "$ROOT/$UUID/." "$STAGE/"
jq --arg v "$VERSION" '. + {"version-name": $v}' "$ROOT/$UUID/metadata.json" > "$STAGE/metadata.json"

mkdir -p "$ROOT/dist"
rm -f "$OUT"
(cd "$STAGE" && zip -qr "$OUT" .)
echo "$OUT"
