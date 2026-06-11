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
mkdir -p "$DEST"
cp -R "$SRC/CSXS" "$SRC/panel" "$SRC/jsx" "$DEST/"

defaults write com.adobe.CSXS.11 PlayerDebugMode 1 2>/dev/null || true
defaults write com.adobe.CSXS.12 PlayerDebugMode 1 2>/dev/null || true

echo "DropComp 2.1.0 installed. Restart After Effects, then Window > Extensions > DropComp."
