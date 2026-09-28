#!/usr/bin/env bash
# Po scaleniu gałęzi portu: pliki zmienione przez scalenie wypakowuje ponownie z LF.
# Repo ma core.autocrlf=true, więc `git merge` zapisuje zmienione pliki z CRLF, a kilka testów-strażników (regexy po
# źródłach) pada wtedy fałszywie. Dotyka tylko plików, które po scaleniu są czyste (bez niezacommitowanych zmian).
#
#   bash scripts/webgpu/lf-po-scaleniu.sh [zakres, domyślnie HEAD^1..HEAD]
set -euo pipefail
REPO="$(git rev-parse --show-toplevel)"
cd "$REPO"
ZAKRES="${1:-HEAD^1..HEAD}"
mapfile -t PLIKI < <(git diff --name-only --diff-filter=AMR "$ZAKRES")
BRUDNE="$(git status --porcelain | cut -c4-)"
N=0
for p in "${PLIKI[@]}"; do
  [ -f "$p" ] || continue
  if printf '%s\n' "$BRUDNE" | grep -qxF "$p"; then continue; fi
  if git ls-files --eol -- "$p" | grep -q 'i/lf.*w/crlf'; then
    rm -f -- "$p" && git -c core.autocrlf=false checkout -- "$p"
    N=$((N + 1))
  fi
done
echo "LF przywrócone w $N plikach (zakres $ZAKRES)"
