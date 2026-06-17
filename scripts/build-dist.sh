#!/bin/bash
# Builds dist/DropComp-<version>.zip from the current tree (version = package.json).
set -e
cd "$(dirname "$0")/.."
V=$(node -p "require('./package.json').version")
rm -rf "dist/DropComp-$V" "dist/DropComp-$V.zip"
mkdir -p "dist/DropComp-$V"
cp -R CSXS panel jsx install.bat install.command README.md "dist/DropComp-$V/"
# Strip dev-only artifacts that live in panel/ but must not ship (gitignored
# locally, so cp -R still picks them up): the browser mock harness.
rm -f "dist/DropComp-$V/panel/_harness.html"
find "dist/DropComp-$V" -name ".DS_Store" -delete
(cd dist && zip -rq "DropComp-$V.zip" "DropComp-$V")
echo "dist/DropComp-$V.zip"
