---
paths:
  - "dema/kontakty-czujnikow.html"
  - "dema/kontakty-czujnikow.js"
  - "dema/kontakty-czujnikow/**"
  - "scripts/webgpu/kontakty-demo.mjs"
  - "tests/kontaktyCzujnikow.test.mjs"
---

# Wygląd KONTAKTU czujników: propozycje w TSL (demo), zasady pod wpięcie

> Reguła obszaru. Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Stan (2026-11-04): etap 1 — demo czterech propozycji czeka na wybór użytkownika; gra bez zmian

- KONTAKT = „coś tam jest, ale nie wiesz co” (wykryty czujnikami, bez identyfikacji) — część mechaniki zasięgu radarów (reguła `zasieg-czujnikow`, prototyp `?radarZasiegi`; dziś kontakt to przerywane koło z „?” w `src/ui/radarRangeOverlay.js` / `src/ui/cicCoverageLayer.js`). Prośba użytkownika: „zaawansowane shadery WebGPU … nieznajome morfujące kształty / chmurki” — coś własnego zamiast trójkątów Starsectora. Plan, opis propozycji i etap 2: `docs/PLAN-kontakt-czujnikow.md`.
- Demo `dema/kontakty-czujnikow.html` (Core3D, TSL; shadery `dema/kontakty-czujnikow/kontaktyTSL.js`): 1 ECHO (plama-echo luminoforu, metakule, warstwice, malowanie wiązką radaru), 2 OBŁOK (chmura zakłóceń), 3 WIR (wir masy z ciemnym jądrem i soczewką), 4 RÓJ (iskry prawdopodobieństwa krążące jak rój), 0 — dzisiejszy znacznik prototypu, 5 — porównanie 2 × 2. Sceny: plansza rozmiarów (4 klasy, ten sam DUŻY przy ±0,25 / 1,3 / 2,6 km, flota ×6, para zbliżająca się i rozchodząca), „jak w grze” (Atlas, wzrok 18 km, niepewność z odległości jak w modelu). Klawisze i adres — plan § 2.

## Zasady (pod wpięcie)

- Rozmiar z kształtu (klasy `contactSizeClass` → R „ciała” 380 / 600 / 900 / 1350 j., najmniej 6 / 8 / 10 / 13 px), niepewność `err` rozmywa i rozsuwa kształt, barwa „nieznany” (bursztyn NTDS, `RADAR_RGB.unknown`) — NIE czerwień wroga ani błękit swoich: obraz nie zdradza strony ani klasy. Flota = suma pól (jeden kształt), nie znaczek na kontakt.
- Każda propozycja to JEDNA funkcja na piksel nad blokiem `uniformArray` o stałej nazwie `kontaktyCzujnikow` (nagłówek 4 × vec4 + 2 × vec4 na kontakt: A = (x, y, R, err) w j. względem środka kadru, osie sceny; B = (klasa, masa, ziarno, alfa); ≤ `KONTAKT_MAX` 48), pętla po kontaktach z odrzuceniem po zasięgu, szum `fxNoise.noise3D` zakotwiczony w świecie (początek kafla 40 km w double na CPU — `noiseBase`), hasze PCG (bez `Math.random`), pochodne poza gałęziami. Graf raz na propozycję, wartości tylko w bloku.
- Zmienne w grafach przez `tv(typ, wyrażenie)` (typ ze STAŁEJ + `assign`) — `.toVar()` z wyrażenia przy łańcuchach haszy budował graf roju > 100 s (pułapka 40, reguła `webgpu-tsl`); test pilnuje budowy < 2 s (dziś 20–30 ms na graf).
- Kontakt leży POD MGŁĄ WOJNY, a mgła w „uber” przygasza wszystko pod sobą — w grze funkcja idzie do postu PO `applyFogOfWar` (bez bloomu — jasność dobrana na nowo), nie do sceny. Soczewka WIR — `Core3D.fxDistortion().implode` na kontakt.
- Miejsce kontaktu z gry przychodzi co 0,2 s (`refreshSec` obrazu czujników) — widok goni je wykładniczo (τ ~0,45 s), inaczej kształt skacze 5 razy na sekundę.

## Jak sprawdzić

- `node --test tests/kontaktyCzujnikow.test.mjs` (WGSL 4 propozycji i tła w Node, bez `pow`, blok o stałej nazwie, czas budowy).
- `node scripts/webgpu/kontakty-demo.mjs [--out .tmp/kontakty/demo] [--tylko porownanie,echo,oblok,wir,roj,ruch,dzis] [--film 1]` — zrzuty (porównanie, plansza i „jak w grze” każdej propozycji, klatki ruchu, dzisiejszy znacznik), czas GPU, pipeline'y synchroniczne (0), błędy; `--film` — 48 klatek porównania co 0,1 s w skali 0,5 (do animacji). Headless Chrome — nie przy grze użytkownika.
- Koszt (2026-11-04, 1600 × 900, 15 kontaktów, pojedyncze próbki zegara GPU — orientacyjnie): +0,03–0,08 ms GPU na propozycję nad pustą klatką demo (0,065 ms); porównanie 2 × 2 (4 kwady pełnoekranowe) ~0,2 ms.
