#!/bin/bash
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/DropComp"
BACKUP="$HOME/Documents/DropComp/backup-v1.1.0.zip"

if [ -d "$DEST" ] && [ ! -L "$DEST" ] && [ ! -f "$BACKUP" ]; then
  mkdir -p "$(dirname "$BACKUP")"
  (cd "$(dirname "$DEST")" && zip -rq "$BACKUP" "DropComp")
  echo "Backed up existing extension to $BACKUP"
fi

rm -rf "$DEST"
ln -s "$SRC" "$DEST"

defaults write com.adobe.CSXS.11 PlayerDebugMode 1 2>/dev/null || true
defaults write com.adobe.CSXS.12 PlayerDebugMode 1 2>/dev/null || true

echo "Dev-linked $SRC -> $DEST. Restart After Effects (or close/reopen the panel)."
