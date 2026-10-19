---
paths:
  - "electron/**"
  - "package.json"
  - "vite.config.js"
  - "scripts/wydanie.mjs"
  - "ZBUDUJ-*.bat"
---

# Electron, paczka i wydanie

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Pliki obszaru (z mapy repozytorium)

- **`package.json`** — serwer dev i zależności; sekcja `build` = pakowanie Electrona (`npm run package` → `dist-electron/HULLFALL-Setup-<wersja>.exe`, instalator NSIS, ikona `build/icon.ico`). Wydanie z podbiciem wersji: dwuklik `ZBUDUJ-INSTALATOR.bat` (`scripts/wydanie.mjs`; nieudany build cofa wersję); przenośny exe bez instalacji: `ZBUDUJ-PORTABLE.bat` (`wydanie.mjs --portable`, `npm run package:portable` → `dist-electron/HULLFALL-Portable-<wersja>.exe`; `--oba` — oba naraz, wybór „t” — bez podbicia wersji; przy każdym starcie rozpakowuje ~650 MB do `%TEMP%\HULLFALL-portable` — okno po ~20 s; zapis gry ten sam co w instalacji, `Dokumenty\HULLFALL`). Brak `node_modules/electron/dist` (postinstall Electrona się nie wykonał) wywala oba buildy — `node node_modules/electron/install.js`; `"version"` to jedyne źródło numeru — menu gry dostaje go przez `__HULLFALL_VERSION__` w `index.html` (wtyczka w `vite.config.js`). `appId` (`com.hullfall.game`) zostaje stały — po nim Windows rozpoznaje instalację przy aktualizacji. `electronDist` = Electron z `node_modules` (rozpakowanie z zipa kończy się zmianą nazwy `win-unpacked.tmp`, którą na maszynie użytkownika blokuje antywirus: EPERM). three jest w `devDependencies` — Vite wkleja go do bundla, paczka nie potrzebuje `node_modules`.

- **`electron/main.js`** — okno Electrona, gra z `dist/` przez schemat `app://` (WebGPU, COOP/COEP). Dane (localStorage, profil Chromium) w `Dokumenty\HULLFALL` (decyzja użytkownika 2026-10-07); pierwsze uruchomienie kopiuje `Local Storage` z dawnego `%APPDATA%\Statki Demo`. Ustawienia STARTU (flagi Chromium czytane tylko przy starcie procesu — dziś VSync, § „Opcje grafiki”) w `Dokumenty\HULLFALL\uruchomienie.json`; strona ma do nich most `electron/preload.js` → `window.hullfallApp` (stan tego uruchomienia, zapis wyboru, `relaunch`; IPC tylko dla strony z `app://bundle/`). Narzędzia kopiujące `main.js` z podmianami (`render-worker-proto.mjs --electron`, `vsync-electron.mjs`) szukają dosłownych fragmentów — zmiana tych linii = poprawka narzędzi.
