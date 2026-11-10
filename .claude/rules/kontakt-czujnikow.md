---
paths:
  - "dema/kontakty-czujnikow.html"
  - "dema/kontakty-czujnikow.js"
  - "dema/kontakty-czujnikow/**"
  - "scripts/webgpu/kontakty-demo.mjs"
  - "tests/kontaktyCzujnikow.test.mjs"
---

# Wygląd KONTAKTU czujników i CZUJKI na PPM (struna + błona): propozycje w TSL (demo), zasady pod wpięcie

> Reguła obszaru. Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Stan (2026-11-10): KONTAKT wybrany, CZUJKA (struna + błona) — trzecia runda w demie, czeka na ocenę; gra bez zmian

- KONTAKT = „coś tam jest, ale nie wiesz co” (wykryty czujnikami, bez identyfikacji) — część mechaniki zasięgu radarów (reguła `zasieg-czujnikow`, prototyp `?radarZasiegi`). Decyzja użytkownika: „obłoki są super, a echo jest dobre na asteroidy” → nieznany KONTAKT = OBŁOK, ECHO = wygląd skał / asteroid, WIR i RÓJ odpadają (zostają w demie do porównania). Plan, decyzje i etap 2: `docs/PLAN-kontakt-czujnikow.md`.
- Demo `dema/kontakty-czujnikow.html` (Core3D, TSL; shadery `dema/kontakty-czujnikow/kontaktyTSL.js`): 1 ECHO, 2 OBŁOK, 3 WIR, 4 RÓJ, 0 — dzisiejszy znacznik prototypu, 5 — porównanie 2 × 2. Sceny: plansza rozmiarów, „jak w grze”.
- CZUJKA (decyzja użytkownika 2026-11-10: „gracz będzie klikał PPM i wtedy pojawi się czujka radaru … do ciał niebieskich błona, do technologicznych struna … błona jest 360 stopni, struna w stronę, w którą pokazuje myszka”) — tryb W tego dema, shadery `namiarTSL.js`, sceny i stan `namiarDemo.js`: 1 CZUJKA (struna + błona), 2 STRUNA, 3 BŁONA osobno, 0 WACHLARZ (druga runda, do porównania). BŁONA: 360° wokół mnie, wybrzuszenia w stronę WSZYSTKICH ciał niebieskich układu (bliżej = większe, większe ciało = szersze, barwa = rodzaj). STRUNA: łuk w stronę myszki, drga z siły sygnału technologicznego w tym kierunku (pusty — prawie prosta), nad grupą w namiarze trójkąty: ile wrogów, tyle trójkątów, mały = statek, duży = budowla, duże w środku. Wykrycie (grupa w namiarze ma `them` ≥ 1): czerwień, „!”, oko przy kursorze otwarte. Sceny: MISJA 1 (baza za kadrem, PPM w lewo, przeciągnięcie na bazę), UKŁAD (pusty układ, same planety), PRZELOT. NIE wracać do: połówek przy okręcie (1. runda), pękania struny i agresywnego drgania (2. runda — „struna zbyt agresywnie wibruje … nie musi się przebijać na pół”).

## Zasady (pod wpięcie)

- Rozmiar z kształtu (klasy `contactSizeClass` → R „ciała” 380 / 600 / 900 / 1350 j., najmniej 6 / 8 / 10 / 13 px), niepewność `err` rozmywa i rozsuwa kształt, barwa „nieznany” (bursztyn NTDS, `RADAR_RGB.unknown`) — NIE czerwień wroga ani błękit swoich: obraz nie zdradza strony ani klasy. Flota = suma pól (jeden kształt), nie znaczek na kontakt.
- Każda propozycja to JEDNA funkcja na piksel nad blokiem `uniformArray` o stałej nazwie `kontaktyCzujnikow` (nagłówek 4 × vec4 + 2 × vec4 na kontakt: A = (x, y, R, err) w j. względem środka kadru, osie sceny; B = (klasa, masa, ziarno, alfa); ≤ `KONTAKT_MAX` 48), pętla po kontaktach z odrzuceniem po zasięgu, szum `fxNoise.noise3D` zakotwiczony w świecie (początek kafla 40 km w double na CPU — `noiseBase`), hasze PCG (bez `Math.random`), pochodne poza gałęziami. Graf raz na propozycję, wartości tylko w bloku.
- Zmienne w grafach przez `tv(typ, wyrażenie)` (typ ze STAŁEJ + `assign`) — `.toVar()` z wyrażenia przy łańcuchach haszy budował graf roju > 100 s (pułapka 40, reguła `webgpu-tsl`); test pilnuje budowy < 2 s (dziś 20–30 ms na graf).
- Kontakt leży POD MGŁĄ WOJNY, a mgła w „uber” przygasza wszystko pod sobą — w grze funkcja idzie do postu PO `applyFogOfWar` (bez bloomu — jasność dobrana na nowo), nie do sceny. Soczewka WIR — `Core3D.fxDistortion().implode` na kontakt.
- CZUJKA — dane: grupy technologiczne (kierunek, `me` = moje czujniki × ich sygnatura / d — siła sygnału, `them` = ich czujniki × moja sygnatura / d — ≥ 1: widzą mnie, `est`, liczba budowli i statków), ciała niebieskie (kierunek, odległość, promień, rodzaj 0 skalista / 1 gazowa / 2 lodowa-wodna / 3 gwiazda). Blok `namiarCzujnikow`: nagłówek 2 × vec4, kotwice (mój okręt) 4 × vec4, znaczniki 4 × vec4 — układ pól opisany w nagłówku `namiarTSL.js` (struna: kotwica = celowanie, amplituda, τ, widoczność, wykrycie; znacznik = gromada trójkątów: kąt względem celowania, budowle, statki, wyłonienie, wykrycie, est, błysk „!”; błona: znacznik = ciało: kierunek, bliskość, szerokość, wyłonienie, rodzaj).
- Stan czujki liczy CPU po stronie widoku (`namiarDemo.js` → `step`): celowanie goni myszkę z ograniczeniem prędkości obrotu, amplituda i bogactwo harmonicznych z sygnału (gładko, τ 0,35 / 0,5 s), szarpnięcie przy wejściu grupy w namiar, τ struny całkowany na CPU (dτ = (1 + 0,6·h²) dt — mnożnik czasu w shaderze dawałby skoki fazy), wyłonienia gromad, wykrycie z histerezą 1 / 0,975, sprężyna wyłonienia ciał (echo impulsu). W shaderze same formuły.
- STRUNA: częstotliwości niewspółmierne (bez okresu, bez pików EKG), 3 mody, najwyżej ~5,5 px amplitudy; trójkąt jedzie ze struną (miejsce i nachylenie z tych samych modów w punkcie gromady), kreska cienka (rdzeń ~0,8 px). Gromady liczy pętla po trójkątach (≤ ~12 na grupę) tylko w pobliżu gromady (odrzucenie po długości łuku).
- BŁONA: szum `noise3D` to kafel 64³ — współrzędna kątowa w całkowitych kaflach na obrót (kilka, nie dziesiątki — kratka aliasingu), `F` = odległość od brzegu z pochodną po kącie liczoną analitycznie, bez `fwidth` (pętla i gałąź — pułapka 15); szum brzegu mały (±6% promienia), inaczej najdalsze ciała (wybrzuszenie ~18% promienia) giną w falowaniu.
- Barwy podawane LINIOWO (sRGB nakładki → liniowo), inaczej po ACES niebieski i czerwony blakną do bieli. Refrakcja impulsu czujki: siatka na warstwie DIST (`Core3D.addFxStep` → `setDistortLayerActive` — flagę kasuje start klatki efektów).
- Miejsce kontaktu z gry przychodzi co 0,2 s (`refreshSec` obrazu czujników) — widok goni je wykładniczo (τ ~0,45 s), inaczej kształt skacze 5 razy na sekundę.

## Jak sprawdzić

- `node --test tests/kontaktyCzujnikow.test.mjs` (WGSL 4 propozycji kontaktu, struny, błony z warstwą DIST, wachlarza i tła w Node, bez `pow`, bloki o stałych nazwach, czas budowy).
- `node scripts/webgpu/kontakty-demo.mjs [--out .tmp/kontakty/demo] [--tylko porownanie,echo,oblok,wir,roj,ruch,dzis,namiar,namiar-szybko] [--film 1] [--film-namiar 1|misja|uklad|przelot|zblizenie]` — zrzuty, czas GPU, pipeline'y synchroniczne (0), błędy; `--film` — klatki kontaktów co 0,1 s; `--film-namiar` — klatki czujki 60 kl/s (pełne pętle scen w skali 0,75; zbliżenie struny przy Atlasie w misji 1, piksel w piksel). Animacje składa się z klatek np. PIL do WebP; drgania ocenia się w ruchu, nie ze zrzutu. Headless Chrome — nie przy grze użytkownika.
- Nie edytuj plików dema ani `dema/index.html` w trakcie przebiegu harnessu: Vite przeładowuje stronę i klatki idą w próżnię.
- Koszt (2026-11-04, 1600 × 900, pojedyncze próbki zegara GPU — orientacyjnie; liczby: plan): kontakt +0,03–0,08 ms nad pustą klatką demo (0,065 ms), czujka (struna + błona, 2026-11-10) +~0,1 ms; w 5120 × 1440 do zmierzenia przy wpięciu.
