#!/usr/bin/env bash
# Build dist/ai-usage@local.shell-extension.zip (same layout as `gnome-extensions pack`).
# Optional $1: version name written into metadata.json as "version-name" (e.g. 1.2.0).
set -euo pipefail

UUID=ai-usage@local
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp -r "$ROOT/$UUID/." "$STAGE/"

if [ -n "${1:-}" ]; then
    jq --arg v "$1" '. + {"version-name": $v}' "$ROOT/$UUID/metadata.json" > "$STAGE/metadata.json"
fi

mkdir -p "$ROOT/dist"
rm -f "$ROOT/dist/$UUID.shell-extension.zip"
(cd "$STAGE" && zip -qr "$ROOT/dist/$UUID.shell-extension.zip" .)
echo "$ROOT/dist/$UUID.shell-extension.zip"
