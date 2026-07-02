#!/bin/bash
# Double-clickable installer for the release zip. NOTE: macOS Gatekeeper may
# block this file because it is unsigned - the reliable path is the Terminal
# one-liner in the README (curl .. | bash), which is never quarantined.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/DropComp"

if [ -d "$DEST" ] && [ ! -L "$DEST" ]; then
  BACKUP="$HOME/Documents/DropComp/backup-$(date +%Y%m%d-%H%M%S).zip"
  mkdir -p "$(dirname "$BACKUP")"
  (cd "$(dirname "$DEST")" && zip -rq "$BACKUP" "DropComp")
  echo "Backed up existing extension to $BACKUP"
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC/CSXS" "$SRC/panel" "$SRC/jsx" "$DEST/"

for CSXS_VERSION in 8 9 10 11 12; do
  defaults write "com.adobe.CSXS.$CSXS_VERSION" PlayerDebugMode 1 2>/dev/null || true
done

# the zip came from the internet, so everything copied out of it carries the
# quarantine attribute - strip it or the panel may not load
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo "DropComp installed. Restart After Effects, then Window > Extensions > DropComp."
