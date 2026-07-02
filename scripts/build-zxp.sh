#!/bin/bash
# Builds dist/DropComp-<version>.zxp (version = package.json), self-signed for
# installation with the free aescripts ZXP Installer. Customers double-click /
# drag the .zxp - no Terminal, no Gatekeeper prompt (the installer app itself
# is notarized by aescripts). After the first install, DropComp's in-panel
# self-updater takes over; it also re-asserts PlayerDebugMode on boot, which
# keeps the panel loading after updates invalidate the ZXP signature.
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(node -p "require('./package.json').version")
BIN="scripts/bin/ZXPSignCmd"
CERT="scripts/certs/dropcomp-selfsigned.p12"
PASS="${DROPCOMP_CERT_PASS:-dropcomp}"

# Adobe's free signer, fetched once (gitignored; quarantine stripped so the
# local build can run it)
if [ ! -x "$BIN" ]; then
  mkdir -p scripts/bin
  curl -fsSL -o "$BIN" "https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/ZXPSignCMD/4.1.3/macOS/ZXPSignCmd"
  chmod +x "$BIN"
  xattr -d com.apple.quarantine "$BIN" 2>/dev/null || true
fi

# one-time self-signed certificate (kept locally, never committed)
if [ ! -f "$CERT" ]; then
  mkdir -p scripts/certs
  "$BIN" -selfSignedCert IN Maharashtra "Ziscol Media" "DropComp" "$PASS" "$CERT"
fi

STAGE="dist/zxp-stage-$V"
rm -rf "$STAGE" "dist/DropComp-$V.zxp"
mkdir -p "$STAGE"
cp -R CSXS panel jsx "$STAGE/"
rm -f "$STAGE/panel/_harness.html"
find "$STAGE" -name ".DS_Store" -delete
"$BIN" -sign "$STAGE" "dist/DropComp-$V.zxp" "$CERT" "$PASS"
rm -rf "$STAGE"
echo "dist/DropComp-$V.zxp"
