---
paths:
  - "dema/kontakty-czujnikow.html"
  - "dema/kontakty-czujnikow.js"
  - "dema/kontakty-czujnikow/**"
  - "scripts/webgpu/kontakty-demo.mjs"
  - "tests/kontaktyCzujnikow.test.mjs"
---

# Wygląd KONTAKTU czujników i NAMIARU (wachlarz, struna, błona): propozycje w TSL (demo), zasady pod wpięcie

> Reguła obszaru. Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Stan (2026-11-04): KONTAKT wybrany, NAMIAR — druga runda propozycji czeka na wybór; gra bez zmian

- KONTAKT = „coś tam jest, ale nie wiesz co” (wykryty czujnikami, bez identyfikacji) — część mechaniki zasięgu radarów (reguła `zasieg-czujnikow`, prototyp `?radarZasiegi`). Decyzja użytkownika: „obłoki są super, a echo jest dobre na asteroidy” → nieznany KONTAKT = OBŁOK, ECHO = wygląd skał / asteroid, WIR i RÓJ odpadają (zostają w demie do porównania). Plan, opis propozycji, decyzje i etap 2: `docs/PLAN-kontakt-czujnikow.md`.
- Demo `dema/kontakty-czujnikow.html` (Core3D, TSL; shadery `dema/kontakty-czujnikow/kontaktyTSL.js`): 1 ECHO, 2 OBŁOK, 3 WIR, 4 RÓJ, 0 — dzisiejszy znacznik prototypu, 5 — porównanie 2 × 2. Sceny: plansza rozmiarów, „jak w grze”.
- NAMIAR = „kto kogo już widzi” między mną a grupą wrogów — tryb W tego dema, shadery `namiarTSL.js`, sceny i stan zdarzeń `namiarDemo.js`: 1 WACHLARZ (jeden na okręt: przy mnie niebieski z `me`, przy wrogu czerwony z `them`, na jednej prostej, naprzeciw siebie), 2 STRUNA (gładki łuk przy mnie drga tym mocniej, im bliżej `them` = 1, przy progu pęka; słabsza struna przy wrogu drga z `me`), 3 BŁONA (jedna błona wokół mnie: promień = mój ślad, wybrzuszenia w stronę grup rosną z `them`, przy progu czerwienieje i pęka), 5 — porównanie w trzech pasach. Sceny: STANY (daleko, tuż przed progiem, wykryty), PRZELOT (pętla 27 s: zbliżanie, próg, cicha praca, ciąg, odejście), GRUPY (blisko, kontakt bez identyfikacji — OBŁOK, `est`; poza kadrem). Atlas i wróg zawsze w jednym kadrze, w realnej skali. Pierwsza runda (dwie połówki przy okręcie gracza: PULS / FALA / ISKRY) odrzucona — NIE wracać do połówek („przeciwnik też ma swój wachlarz, a nie że ja mam dwa”).

## Zasady (pod wpięcie)

- Rozmiar z kształtu (klasy `contactSizeClass` → R „ciała” 380 / 600 / 900 / 1350 j., najmniej 6 / 8 / 10 / 13 px), niepewność `err` rozmywa i rozsuwa kształt, barwa „nieznany” (bursztyn NTDS, `RADAR_RGB.unknown`) — NIE czerwień wroga ani błękit swoich: obraz nie zdradza strony ani klasy. Flota = suma pól (jeden kształt), nie znaczek na kontakt.
- Każda propozycja to JEDNA funkcja na piksel nad blokiem `uniformArray` o stałej nazwie `kontaktyCzujnikow` (nagłówek 4 × vec4 + 2 × vec4 na kontakt: A = (x, y, R, err) w j. względem środka kadru, osie sceny; B = (klasa, masa, ziarno, alfa); ≤ `KONTAKT_MAX` 48), pętla po kontaktach z odrzuceniem po zasięgu, szum `fxNoise.noise3D` zakotwiczony w świecie (początek kafla 40 km w double na CPU — `noiseBase`), hasze PCG (bez `Math.random`), pochodne poza gałęziami. Graf raz na propozycję, wartości tylko w bloku.
- Zmienne w grafach przez `tv(typ, wyrażenie)` (typ ze STAŁEJ + `assign`) — `.toVar()` z wyrażenia przy łańcuchach haszy budował graf roju > 100 s (pułapka 40, reguła `webgpu-tsl`); test pilnuje budowy < 2 s (dziś 20–30 ms na graf).
- Kontakt leży POD MGŁĄ WOJNY, a mgła w „uber” przygasza wszystko pod sobą — w grze funkcja idzie do postu PO `applyFogOfWar` (bez bloomu — jasność dobrana na nowo), nie do sceny. Soczewka WIR — `Core3D.fxDistortion().implode` na kontakt.
- NAMIAR — dane na grupę: `them` = ich czujniki × MOJA sygnatura / d (≥ 1 → wykryli mnie), `me` = moje czujniki × ICH sygnatura / d (≥ 1 → ja wykrywam ich), `est` = 1 — ich czujniki zgadnięte (czerwień słabsza albo rwana). Blok `namiarCzujnikow`: nagłówek 2 × vec4, kotwice (mój okręt) 2 × vec4, znaczniki 4 × vec4 — M0 = (sx, sy, r0, kierunek) w px bufora (y od góry, kąt jak canvas), M1 = (ułamek, est, ziarno, strona), M2 = (rozbłysk, szczelina, wiek pęknięcia, τ), M3 = (limit połowy kąta — sąsiednie grupy się nie nakładają). Który ułamek idzie do którego znacznika, zależy od propozycji: WACHLARZ — przy mnie `me`, przy wrogu `them`; STRUNA — przy mnie `them`, przy wrogu `me`; BŁONA — tylko grupy przy mnie, `them`. Poza kadrem znacznik wroga stoi przy krawędzi ekranu na prostej od mojego okrętu.
- Stan zdarzeń liczy CPU po stronie widoku, shader ma same formuły: rozbłysk 1 → 0 w 0,9 s, szczelina 0..1 (τ 0,07 s otwieranie, 0,2 s zrastanie), histereza progu 1 / 0,975 (ułamek drgający wokół 1 nie pęka co klatkę). τ struny całkowany na CPU (dτ = (1 + k²) dt): mnożnik czasu liczony w shaderze dawałby skoki fazy przy każdej zmianie `them`.
- STRUNA: częstotliwości harmonicznych niewspółmierne (bez okresu i bez pików EKG), ślad luminoforu = 3 opóźnione próbki czasu (bez nich wyższe harmoniczne w 60 kl/s stroboskopują), kreska cienka (rdzeń ~0,8 px, jasność do ~1,1) — grubsza i jaśniejsza blaknie w bloomie do białej rury. Barwa końców po pęknięciu = strona, która sięgnęła (przy mnie czerwień, przy wrogu błękit).
- BŁONA: szum `noise3D` to kafel 64³ — współrzędna kątowa w całkowitych kaflach na obrót (kilka, nie dziesiątki: 38 kafli na obrót dawało kratkę aliasingu), `F` = odległość od brzegu z pochodną po kącie liczoną analitycznie, bez `fwidth` (jesteśmy w pętli i gałęzi — pułapka 15).
- Barwy podawane LINIOWO (sRGB nakładki → liniowo), inaczej po ACES niebieski i czerwony blakną do bieli. Refrakcja fali pęknięcia: siatka na warstwie DIST (`Core3D.addFxStep` → `setDistortLayerActive` — flagę kasuje start klatki efektów).
- Miejsce kontaktu z gry przychodzi co 0,2 s (`refreshSec` obrazu czujników) — widok goni je wykładniczo (τ ~0,45 s), inaczej kształt skacze 5 razy na sekundę.

## Jak sprawdzić

- `node --test tests/kontaktyCzujnikow.test.mjs` (WGSL 4 propozycji kontaktu, 3 propozycji namiaru z warstwą DIST i tła w Node, bez `pow`, bloki o stałych nazwach, czas budowy).
- `node scripts/webgpu/kontakty-demo.mjs [--out .tmp/kontakty/demo] [--tylko porownanie,echo,oblok,wir,roj,ruch,dzis,namiar,namiar-szybko] [--film 1] [--film-namiar 1|porownanie|wachlarz|struna|blona]` — zrzuty, czas GPU, pipeline'y synchroniczne (0), błędy; `--film` — klatki kontaktów co 0,1 s; `--film-namiar` — klatki 60 kl/s (porównanie: pełna pętla 27 s w skali 0,75; zbliżenia przy Atlasie: 8 s przez próg, piksel w piksel). Animacje składa się z klatek np. PIL do WebP; drgania ocenia się w ruchu, nie ze zrzutu. Headless Chrome — nie przy grze użytkownika.
- Nie edytuj plików dema ani `dema/index.html` w trakcie przebiegu harnessu: Vite przeładowuje stronę i klatki idą w próżnię.
- Koszt (2026-11-04, 1600 × 900, pojedyncze próbki zegara GPU — orientacyjnie; liczby: plan): kontakt +0,03–0,08 ms nad pustą klatką demo (0,065 ms), namiar +0,02–0,06 ms; w 5120 × 1440 do zmierzenia przy wpięciu.
