#!/usr/bin/env bash
# Inwentarz portu z czystego eksportu HEAD — bez niezacommitowanych zmian w katalogu roboczym (inne sesje, dema w toku).
# Wynik: docs/webgpu/INWENTARZ.md i .tmp/webgpu/inwentarz.json jak po `node scripts/webgpu/inwentarz.mjs` na czystym HEAD.
#
#   bash scripts/webgpu/inwentarz-czysty.sh
set -euo pipefail
REPO="$(git rev-parse --show-toplevel)"
S="$REPO/.tmp/webgpu/inw-eksport"
rm -rf "$S"
mkdir -p "$S/.git"
cd "$REPO"
git archive --format=tar HEAD -- ':(glob)**/*.js' ':(glob)**/*.mjs' ':(glob)**/*.html' | tar -x -C "$S"
printf 'ref: refs/heads/main\n' > "$S/.git/HEAD"
( cd "$S" && node scripts/webgpu/inwentarz.mjs --cicho )
cp "$S/docs/webgpu/INWENTARZ.md" "$REPO/docs/webgpu/INWENTARZ.md"
mkdir -p "$REPO/.tmp/webgpu"
cp "$S/.tmp/webgpu/inwentarz.json" "$REPO/.tmp/webgpu/inwentarz.json"
rm -rf "$S"
echo "INWENTARZ odświeżony z HEAD $(git rev-parse --short HEAD)"
