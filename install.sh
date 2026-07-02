#!/bin/bash
# DropComp one-line installer for macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/ziscolwp/dropcomp/main/install.sh | bash
#
# Terminal-run scripts are not quarantined by Gatekeeper, so this works without
# an Apple Developer signature - unlike a double-clicked .command or .pkg,
# which macOS blocks for unsigned developers. No admin rights needed: the CEP
# extensions folder lives in the user's home Library.
set -euo pipefail

REPO="ziscolwp/dropcomp"
# DROPCOMP_DEST override is for tests/CI only
DEST="${DROPCOMP_DEST:-$HOME/Library/Application Support/Adobe/CEP/extensions/DropComp}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This installer is for macOS. On Windows, download the release zip and run install.bat:"
  echo "  https://github.com/$REPO/releases/latest"
  exit 1
fi

echo "Fetching the latest DropComp release..."
API_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")
TAG=$(printf '%s' "$API_JSON" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
ZIP_URL=$(printf '%s' "$API_JSON" | sed -n 's/.*"browser_download_url": *"\([^"]*\.zip\)".*/\1/p' | head -1)
if [ -z "$TAG" ]; then
  echo "Could not read the latest release from GitHub. Check your connection and try again." >&2
  exit 1
fi
# fall back to the source archive if a release has no zip asset
if [ -z "$ZIP_URL" ]; then
  ZIP_URL="https://github.com/$REPO/archive/refs/tags/$TAG.zip"
fi

TMP=$(mktemp -d /tmp/dropcomp-install.XXXXXX)
trap 'rm -rf "$TMP"' EXIT

echo "Downloading DropComp $TAG..."
curl -fsSL "$ZIP_URL" -o "$TMP/dropcomp.zip"
unzip -q "$TMP/dropcomp.zip" -d "$TMP/unpacked"

# the payload is wherever CSXS/manifest.xml landed (release zip or source zip)
SRC=$(dirname "$(find "$TMP/unpacked" -type f -path '*/CSXS/manifest.xml' | head -1)")/..
SRC=$(cd "$SRC" && pwd)
if [ ! -d "$SRC/CSXS" ] || [ ! -d "$SRC/panel" ] || [ ! -d "$SRC/jsx" ]; then
  echo "The downloaded archive does not look like a DropComp build." >&2
  exit 1
fi

# back up a previous copy-install once (symlinked dev installs are left alone)
if [ -d "$DEST" ] && [ ! -L "$DEST" ]; then
  BACKUP="$HOME/Documents/DropComp/backup-$(date +%Y%m%d-%H%M%S).zip"
  mkdir -p "$(dirname "$BACKUP")"
  (cd "$(dirname "$DEST")" && zip -rq "$BACKUP" "DropComp")
  echo "Backed up the existing extension to $BACKUP"
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC/CSXS" "$SRC/panel" "$SRC/jsx" "$DEST/"

# unsigned CEP extensions need PlayerDebugMode across the CSXS versions AE uses
for CSXS_VERSION in 8 9 10 11 12; do
  defaults write "com.adobe.CSXS.$CSXS_VERSION" PlayerDebugMode 1 2>/dev/null || true
done

# belt and braces: nothing here should be quarantined, but stale attributes
# from an earlier manual install would keep the panel from loading
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo ""
echo "DropComp $TAG installed."
echo "Restart After Effects, then open Window > Extensions > DropComp."
