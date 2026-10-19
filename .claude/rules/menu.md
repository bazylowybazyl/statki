---
paths:
  - "src/3d/menuBackdrop3D*.js"
  - "assets/css/main-menu.css"
---

# Menu główne i jego tło 3D

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Menu główne i jego tło 3D

- Tło menu przed startem gry = Ziemia z ringiem w kamerze kinowej: `MenuBackdrop3D` (`src/3d/menuBackdrop3D.js`). Ring to ring GRY wypożyczony przez `haloRings.showcaseRing('earth')` (mapy pieką się już w menu) i oddany `releaseShowcase` w `stopMenuBackdrop()` tuż przed pierwszą klatką gry (`startGame`). Nie twórz drugiego ringu dla menu.

- Render: `Core3D.renderBackdrop(camera)` — ta sama scena i post (bloom, ACES), tylko warstwa `MENU_BACKDROP_LAYER` (9; na czas menu ring ma na niej wszystkie siatki). Ziemia i niebo tła są dziećmi grupy ringu i liczą światło w układzie ringu (`uCamLocal`, `uSunDir`, `haloRingBlock` z `haloRingTSL.js`); tekstury Ziemi pożyczone od planety gry (`window.EARTH`), mgławica od `NebulaSystem`. Materiały w TSL (`src/3d/menuBackdrop3D.tsl.js`, zadanie 11, 1:1 z dawnym GLSL — Ziemia z poświatą bit w bit z bazą WebGL); mgławica próbkowana z poziomu 0 (pułapka 28).

- Start tła jest w tle, pod kurtyną (`.mm-curtain`): `Core3D.ready` → ring (`showcaseRing`: pieczenie map, odczyt CPU, bryły rozgrzane przed podpięciem — hak `prewarm`) i równolegle Ziemia, poświata i niebo w `Core3D.warmup.now(…, { camera: kamera kinowa, layer: MENU_BACKDROP_LAYER })` → pętla renderu dopiero z gotowym ringiem (`await ring.ready`) i rozgrzanym tłem: pierwsza klatka menu niczego nie kompiluje. Pipeline'y pieczenia map kompiluje sam `HaloWorldMaps.init()` na PRAWDZIWYCH celach bake'u (klucz pipeline'u zależy od formatu celu); dawna scena rozgrzewki `createHaloBakeWarmup` usunięta (11) — pilnuje `tests/menuBackdrop.test.mjs`.

- Style menu: `assets/css/main-menu.css` (osobny plik, wczytywany po `main.css`). JS menu szuka widoków po id i przycisków po klasie `menu-btn-styled` (pad/klawiatura); stare reguły tych klas neutralizuje `all: unset` w zasięgu `#main-menu`.
