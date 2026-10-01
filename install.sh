#!/usr/bin/env bash
set -e
UUID=ai-usage@local
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
mkdir -p "$(dirname "$DEST")"
ln -sfn "$(cd "$(dirname "$0")" && pwd)/$UUID" "$DEST"
gnome-extensions enable "$UUID" 2>/dev/null || true
echo "Wayland: 처음 설치 시 로그아웃 후 다시 로그인하세요."
