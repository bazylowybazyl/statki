---
paths:
  - "dema/kontakty-czujnikow.html"
  - "dema/kontakty-czujnikow.js"
  - "dema/kontakty-czujnikow/**"
  - "scripts/webgpu/kontakty-demo.mjs"
  - "tests/kontaktyCzujnikow.test.mjs"
---

# Wygląd KONTAKTU czujników i WACHLARZY namierzania: propozycje w TSL (demo), zasady pod wpięcie

> Reguła obszaru. Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Stan (2026-11-04): etap 1 — demo czterech propozycji czeka na wybór użytkownika; gra bez zmian

- KONTAKT = „coś tam jest, ale nie wiesz co” (wykryty czujnikami, bez identyfikacji) — część mechaniki zasięgu radarów (reguła `zasieg-czujnikow`, prototyp `?radarZasiegi`; dziś kontakt to przerywane koło z „?” w `src/ui/radarRangeOverlay.js` / `src/ui/cicCoverageLayer.js`). Prośba użytkownika: „zaawansowane shadery WebGPU … nieznajome morfujące kształty / chmurki” — coś własnego zamiast trójkątów Starsectora. Plan, opis propozycji i etap 2: `docs/PLAN-kontakt-czujnikow.md`.
- Demo `dema/kontakty-czujnikow.html` (Core3D, TSL; shadery `dema/kontakty-czujnikow/kontaktyTSL.js`): 1 ECHO (plama-echo luminoforu, metakule, warstwice, malowanie wiązką radaru), 2 OBŁOK (chmura zakłóceń), 3 WIR (wir masy z ciemnym jądrem i soczewką), 4 RÓJ (iskry prawdopodobieństwa krążące jak rój), 0 — dzisiejszy znacznik prototypu, 5 — porównanie 2 × 2. Sceny: plansza rozmiarów (4 klasy, ten sam DUŻY przy ±0,25 / 1,3 / 2,6 km, flota ×6, para zbliżająca się i rozchodząca), „jak w grze” (Atlas, wzrok 18 km, niepewność z odległości jak w modelu). Klawisze i adres — plan § 2.

- WACHLARZE namierzania „) ) )” przy okręcie gracza (prośba użytkownika przez sesję główną, 2026-11-04: „każ sesji dorobić, zobaczymy, co nam nastruga”) — tryb W tego samego dema, shadery `dema/kontakty-czujnikow/wachlarzeTSL.js`, stanowiska `wachlarzeDemo.js`: 1 PULS (świecące łuki, puls biegnie od okrętu — szybszy przy progu, rozbłysk przy przejściu przez 1, żar i grot z poświatą), 2 FALA (grzbiety fal płyną do granicy zasięgu i zginają tło — warstwa DIST Core3D, fala uderzeniowa, gdy sięga), 3 ISKRY (kropki płyną po łukach od okrętu, migocący front na granicy), 0 — rysunek 2D prototypu (`drawBearingFans`), 5 — porównanie. Stanowiska: daleko, blisko progu, sięga, kilka grup (z radarem zgadniętym), cicha praca, przejście przez próg (animacja).

## Zasady (pod wpięcie)

- Rozmiar z kształtu (klasy `contactSizeClass` → R „ciała” 380 / 600 / 900 / 1350 j., najmniej 6 / 8 / 10 / 13 px), niepewność `err` rozmywa i rozsuwa kształt, barwa „nieznany” (bursztyn NTDS, `RADAR_RGB.unknown`) — NIE czerwień wroga ani błękit swoich: obraz nie zdradza strony ani klasy. Flota = suma pól (jeden kształt), nie znaczek na kontakt.
- Każda propozycja to JEDNA funkcja na piksel nad blokiem `uniformArray` o stałej nazwie `kontaktyCzujnikow` (nagłówek 4 × vec4 + 2 × vec4 na kontakt: A = (x, y, R, err) w j. względem środka kadru, osie sceny; B = (klasa, masa, ziarno, alfa); ≤ `KONTAKT_MAX` 48), pętla po kontaktach z odrzuceniem po zasięgu, szum `fxNoise.noise3D` zakotwiczony w świecie (początek kafla 40 km w double na CPU — `noiseBase`), hasze PCG (bez `Math.random`), pochodne poza gałęziami. Graf raz na propozycję, wartości tylko w bloku.
- Zmienne w grafach przez `tv(typ, wyrażenie)` (typ ze STAŁEJ + `assign`) — `.toVar()` z wyrażenia przy łańcuchach haszy budował graf roju > 100 s (pułapka 40, reguła `webgpu-tsl`); test pilnuje budowy < 2 s (dziś 20–30 ms na graf).
- Kontakt leży POD MGŁĄ WOJNY, a mgła w „uber” przygasza wszystko pod sobą — w grze funkcja idzie do postu PO `applyFogOfWar` (bez bloomu — jasność dobrana na nowo), nie do sceny. Soczewka WIR — `Core3D.fxDistortion().implode` na kontakt.
- WACHLARZE: semantyka prototypu bez zmian — niebieska połówka (kąt < 0 względem kierunku grupy, jak `side < 0` w `drawFanHalf`) = MÓJ zasięg / odległość (`me`), czerwona = ICH zasięg względem mnie (`them`), zapalonych łuków = ułamek × 7, puste miejsca słabo, grot = ułamek ≥ 1, zgadnięty radar (`est`) — słabiej / w kreskach / rwane / rzadziej. Geometria w px ekranu jak nakładka (`FAN_GEOM`: 7 łuków co 11 px, połówka 0,2 rad, start r0 = obrys kadłuba + 14 px). Barwy podawane LINIOWO (sRGB nakładki → liniowo), inaczej po ACES niebieski i czerwony blakną do bieli; rdzeń łuku HDR ~1, poświata wąska (σ 1,5 grubości) — szersza zlewa łuki w pas. Rozbłysk przy przejściu przez 1 liczy CPU (1 → 0 w 0,9 s na połówkę). FALA: warstwa DIST zgłaszana z kroku efektów (`Core3D.addFxStep` → `setDistortLayerActive` — flagę kasuje start klatki efektów); przesunięcie zgina też same łuki (są w scenie), więc amplituda mała (~1,4 px, uderzenie 3 px).
- Miejsce kontaktu z gry przychodzi co 0,2 s (`refreshSec` obrazu czujników) — widok goni je wykładniczo (τ ~0,45 s), inaczej kształt skacze 5 razy na sekundę.

## Jak sprawdzić

- `node --test tests/kontaktyCzujnikow.test.mjs` (WGSL 4 propozycji kontaktu, 3 wariantów wachlarzy z warstwą DIST fali i tła w Node, bez `pow`, bloki o stałych nazwach, czas budowy).
- `node scripts/webgpu/kontakty-demo.mjs [--out .tmp/kontakty/demo] [--tylko porownanie,echo,oblok,wir,roj,ruch,dzis,wachlarze] [--film 1]` — zrzuty (porównanie, plansza i „jak w grze” każdej propozycji, klatki ruchu, dzisiejszy znacznik, wachlarze: porównanie i stanowiska każdego wariantu), czas GPU, pipeline'y synchroniczne (0), błędy; `--film` — klatki porównań co 0,1 s w skali 0,5 (`film/`, `film-wachlarze/` — animacje składa się z nich np. PIL do WebP). Headless Chrome — nie przy grze użytkownika.
- Koszt (2026-11-04, 1600 × 900, 15 kontaktów, pojedyncze próbki zegara GPU — orientacyjnie): +0,03–0,08 ms GPU na propozycję nad pustą klatką demo (0,065 ms); porównanie 2 × 2 (4 kwady pełnoekranowe) ~0,2 ms. Wachlarze (6 stanowisk, 9 grup): PULS 0,095, FALA 0,13 (z warstwą DIST), ISKRY 0,097 ms przy pustej klatce 0,065.
