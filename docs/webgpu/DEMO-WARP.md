# Demo WebGPU: warp „Nurt” (propozycja 2, 2026-09-27)

`dema/warp-webgpu.html` (+ `dema/warp-webgpu.js`, moduły w `dema/warp-webgpu/`). Propozycja
efektu warpa od początku na `WebGPURenderer` + TSL (compute). Gra, `Core3D` i poprzednie demo
warpa (`dema/warp-demo.html`, propozycja „Fałda”, `docs/BRIEF-warp.md`) bez zmian.

Start: `npm run dev` → `/dema/warp-webgpu.html`. Adres: `?scene=trip|arrival|fleet|ambush|free`,
`?from=earth&to=jupiter` (trasa sceny 1), `?t=8.5`, `?pause=1`, `?particles=1500000`,
`?hull=supercapital|carrier|battleship|destroyer|frigate|pirate_*` (scena 2), `?shot=1` (bez paneli).
Konsola: `window.__demo` (`scene`, `seek`, `pause`, `stepFrames`, `state`, `lens`, `setTrip`,
`setParticles`).

## Pomysł

**Bańki nie rysujemy.** Przestrzeń ma ośrodek — materię międzyplanetarną (1,5 mln drobin na
GPU) — i bańkę widać po tym, co z nim robi (jak wizualizacja metryki Alcubierre'a / czasu Yorka:
przed statkiem ścisk — turkus, za nim rozrzedzenie — pomarańcz), ale bez siatki.

### Iteracja 2 (uwagi usera 2026-09-27)

User o iteracji 1: lepszy „feel lotu” niż propozycja 1, ale brak planet; wejście i wyjście
„suche”, bez kopa; 1) sam wystrzał ok, 2) przód efektu w locie (kropkowana kopuła przed dziobem)
nie ok, 3) wyjście ma być gwałtowne jak w Star Wars (gwiazdy nagle wracają, wszystko nagle się
pojawia), stożkowy wyrzut za łagodny; przylot floty: puste bańki i nagle okręty źle wyglądają —
ma być prosta smuga i tunel, z którego wypada statek. Stąd:

- **Planety wróciły** — soczewka świata z propozycji 1 (`worldLens.js` = kopia czystych funkcji
  `src/3d/warpWorldLens.js`): prawdziwe odległości, przeloty (Księżyc, Mars) ze zwolnieniem
  (`warpFlybySlowdown`), cel przy krawędzi kadru w ostatnich ~2 s. Start nad brzegiem planety
  (Ziemia: nocna Europa przy krawędzi), koniec 260 px przed brzegiem celu (Jowisz pasami do
  statku) — zatrzymanie nad tarczą dawało w demie bez ringu ekran rozmytej tekstury.
- **Kop przy skoku** — statek wyrywa się do przodu w kadrze (kamera go dogania: 140 px / zoom,
  impuls 0,05 / 0,42 s), gwiazdy strzelają w smugi z przestrzałem ×1,4, zoom −10% i wstrząs,
  planeta startu ucieka za rufę (β soczewki 0 → 1 w 0,5 s), wybuch pomarańczowego warkocza.
- **Wyjście jak w Star Wars** (~0,3 s): przepływ staje w 0,25 s, smugi gwiazd wracają do punktów
  w 0,16 s (front od dziobu), bańka zapada się od czoła w 0,2 s, cel **wskakuje** (β → 0 w 0,3 s,
  a prawdziwa pozycja statku od razu w punkcie zatrzymania — hamowanie z setek tys. j/s w skali
  ciał wyrzucało cel z kadru), błysk przy dziobie, fala, wstrząs, szew i żar brzegu, a ośrodek
  gaśnie w ~0,3 s (bez wiszącej chmury drobin). Stożkowego wyrzutu i „czapy” nie ma.
- **Przód w locie ciemny** — czoło bańki i kieszeń nie świecą w ruchu; światło niesie talia
  (część drobin zapala się przy ścianie i płynie wzdłuż konturu — linie od barków do rufy) i tył
  pasa naprężenia (pomarańczowy warkocz). Płaty ładowania (turkus / pomarańcz) bez zmian.
- **NPC tunelem** (`arrivals.js`, oś czasu z `src/game/warpDrive.js` bez zmian): **zwiastun** —
  prosta nić wzbudzonego ośrodka od krawędzi kadru do punktu wyjścia i punkt zbierania ośrodka;
  **rozdarcie** — szczelina-soczewka wzdłuż kursu (cienkie jasne brzegi, w środku strugi w barwie
  plazmy okrętu; piraci — migocząca, czerwona), ośrodek się rozsuwa, tło wciągane w szczelinę;
  **wyrzut** — okręt wypada z szczeliny (odsłanianie od dziobu ~0,1 s, smuga sylwetki, błysk
  w ujściu, iskry ośrodka pchnięte przed dziób, fala, żar); **zamknięcie** — szczelina gaśnie.
  **Odlot** to samo wspak: punkt skoku przed dziobem, szczelina, okręt przyspiesza i znika w niej
  od dziobu. Bez pustych baniek.

### Co zostało z decyzji usera o poprzednim warpie

- Gwiazdy: smugi PŁASKIE, równoległe do kursu, ogonem do tyłu, rosną już przy ładowaniu; jedno
  pole gwiazd (układ i warstwy jak `StarSystem` gry). Wyjście: front rzeczywistości od dziobu.
- Żadnych świecących okręgów: fale i szczeliny w tle to wyłącznie przezroczysta refrakcja.
- Nad progiem bloomu (0,9) tylko cienkie linie i małe punkty (brzegi szczelin, szew, rdzenie
  dysz, iskry); tarcze planet mają ekspozycję 0,8 (pod progiem).

## Sceny

| # | scena | co pokazuje |
|---|---|---|
| 1 | Podróż Atlasa (pętla ~19 s) | postój nad planetą → ładowanie 3 s → SKOK → przeloty (Ziemia → Jowisz: Księżyc, Mars) → WYJŚCIE przed celem; trasa z list „skąd / dokąd” |
| 2 | Przylot i odlot okrętu (pętla 15 s) | zwiastun → rozdarcie → wyrzut → po 8,8 s odlot w szczelinę; kadłub z listy |
| 3 | Wezwanie floty | klik = flota Terra Nova w punkcie (zwiastuny razem, wyrzuty od najmniejszego, flagowiec ostatni); poprzednia odlatuje tunelami; co 12 s sama |
| 4 | Zasadzka piratów (pętla ~14 s) | pierścień tuneli wokół Atlasa, dziobami do niego; po 9,5 s odwrót |
| 5 | Lot swobodny | W/S ciąg, A/D obrót, Shift (trzymaj 3 s) ładowanie i skok, E/Q bieg, Ctrl albo C wyjście |

## Moduły

| Plik | Co robi | Do gry? |
|---|---|---|
| `medium.js` | ośrodek: bufory storage, krok compute (pola baniek, przegródki zwiastuna / wyrzutu / wydechu, szczeliny tuneli), render smug | **tak** (rdzeń efektu) |
| `rift.js` | szczeliny tuneli (instancje, jeden draw call) | **tak** |
| `arrivals.js` | przylot / odlot NPC: próbka osi `warpDrive.js` → przegródki, szczeliny, odsłanianie, smuga, błyski, fale | **tak** (klej; odlot do przeniesienia do `warpDrive.js`) |
| `hulls.js` | kadłub: odsłanianie frontem, szew, żar brzegu z pola odległości sylwetki, smuga sylwetki | uniformy → materiał kadłuba gry |
| `stars.js` | gwiazdy jak w grze, rozciąganie z przestrzałem, front wyjścia, kwady w px ekranu | logika → `StarSystem` gry |
| `post.js` | 4 passy, fale (refrakcja), zgięcie tła (bańka, szczeliny), bloom (`bloomConfig.js`), ACES gry | logika zniekształceń → post / pass zgięcia tła |
| `worldLens.js` | kopia czystych funkcji `warpWorldLens.js` + `WorldLensView` (bez Core3D) | w grze oryginał |
| `planets.js`, `sky.js`, `glow.js`, `solar.js`, `freeWorld.js`, `scenes.js` | planety TSL, mgławica, duszki blasku, układ i trasy, osie czasu scen | tylko pokaz (osie czasu = specyfikacja liczb) |

## Technika

- **Ośrodek (compute).** 1,5 mln drobin (suwak 0,25–2 mln, pojemność 2²¹), współrzędne sceny
  WZGLĘDEM KOTWICY kamery (CPU podaje przesunięcie kotwicy co krok). Populacja bliska (z od −1500
  do 0, 72%, tu działają pola) i głęboka (do −26 000, paralaksa). Drobina spoza pudła rodzi się
  po drugiej stronie jako świeży ośrodek w spoczynku. Krok stały 1/240 s, render dosuwa drobiny o
  czas od ostatniego kroku.
- **Przegródki** (16; stałe indeksy przez życie przegródki): bańka (`A > 0`: opływ potencjalny,
  naprężenie Yorka, kieszeń, zawirowania, zapłon strug w talii, front zapadania), nić zwiastuna
  (`heraldLen`, `heraldGain`), punkt zbierania (`pullR`, `pullGain`), jednorazowe `release`
  (pchnięcie przed bańkę, np. okręt wypada z tunelu) i `rear` (wydech tyłu). Szczeliny tuneli
  (8): ośrodek w otwarciu świeci i płynie wzdłuż osi, rozpychany na boki gaśnie.
  `setFade(rate)` gasi cały ośrodek (po wyjściu z warpa).
- **Render ośrodka.** Kwad-smuga na drobinę (oba końce rzutowane kamerą persp., kwad w px
  ekranu), energia rozłożona `1/√(1 + L/26 px)`, 45% mgiełki (plamy), reszta iskry; pchnięte
  drobiny rozjaśniają się przez 0,18 s.
- **Klatka.** Passy: niebo (persp.) → planety + gwiazdy (ortho w px ekranu, tarcze zasłaniają
  gwiazdy) → ośrodek (persp.) → gra (ortho: kadłuby, szczeliny, blaski). Fale przesuwają wszystkie
  passy, zgięcie bańki i szczelin tylko niebo. Bloom z `BLOOM_DEFAULTS`, ACES gry.

## Wydajność (RTX 5080, Chrome headless, 1920×1080, 1,5 mln drobin)

350–560 FPS bez vsync, CPU 1,3–2,4 ms na klatkę, GPU render ~0,9 ms, compute ~0,15 ms (średnio
w locie, 4 kroki na klatkę przy 60 Hz). Draw calle: ~20.

## Pułapki (obie iteracje)

- **Cienka powłoka = świecący obrys.** Drobiny przy ścianie bańki widziane z góry układają się w
  kropkowany okrąg (skupienie wzdłuż linii wzroku). Kieszeń nie wpycha drobin, dryf zerowy przy
  ścianie, krawędź rzutu przygaszona (`vis`), a w locie czoło i kieszeń nie świecą — drobiny
  niesione z bańką nie mają smug, więc są kropkami (to była „kopuła”).
- **Warkocz karmiła czapa.** Po usunięciu czapy wzbudzenie w talii przez całkowanie nie nadążało
  (talię drobina mija w ~0,03 s) — zapłon `E = max(E, próg)` w cienkiej warstwie przy ścianie.
- **Pole `herald` w obiekcie przylotu** to czas zwiastuna z `createWarpArrival` — przegródki
  ośrodka nazywają się `heraldSlot` / `pushSlot` (nadpisanie dawało NaN i zwiastun znikał).
- **Rozpychana nić zwiastuna** robiła świecącą „puszkę” wokół okrętu po zamknięciu szczeliny.
- **Gwiazdy i tarcze w jednym passie**: gwiazdy (mieszanie addytywne) są na liście
  NIEPRZEZROCZYSTEJ — z listą przezroczystych rysowałyby się po tarczach mimo `renderOrder`.
- **Duże tarcze**: poświata i brzeg atmosfery w promieniach tarczy przy 7000 px zalewały ekran
  (grubość ścięta w px), światła miast przy powiększeniu tekstury nocy ×18 robiły złote plamy
  (mnożnik maleje z rozmiarem), jasne pasy przekraczały próg bloomu (ekspozycja 0,8).
- **Pula znaczników czasu (2048)** przepełniała się przy przewijaniu — znaczniki wyłączone na
  czas przewijania i wstrzymane, gdy odczyt wisi > 12 klatek.

## Do portu w grze

**Stan (zadanie 22, 2026-09-28): „Nurt” jest w grze** — `src/3d/warp/` (sterownik `WarpNurt`,
opis w `agents.md`, Core3D „Warp „Nurt””). Co poszło gdzie i czym różni się od dema:
- *Ośrodek* (`medium.js`): 1 mln drobin, krok 1/240 s przez `Core3D.addFxStep`, pass `warp` (warstwa 8)
  po ring-planetach; śpi 4 s po ostatniej przegródce (poza warpem 0 kroków i 0 draw calli), przegródki
  poza pudłem wokół kamery nie budzą go (`cullWarpFrameToView`); nowe ziarno po przebudzeniu i skoku
  kamery; pudła z bieżącego zoomu (nie z najmniejszego zoomu sceny) — przy oddaleniu część drobin
  przenosi się w nowy pas pudła. 120 Hz dalej niesprawdzone (krok 1/240 s jak w demie).
- *Skok gracza* (`player.js`) na automacie gry `GameState.warp` (bez zmian rozgrywki). Ładowanie gry
  trwa 0,8 s (demo 3 s): krzywe biegną po ułamku ładowania, naprężenie ×(3 / 0,8), wzbudzenie ×(3 / 0,8)^0,6.
  Wstrząs kopu i wyjścia przez `camera.addShake`. Dawne efekty 2D warpa (cząstki, fale, ładowanie) usunięte.
- *Kop kamery* (zadanie 22-B, 2026-09-28) — w rigu kamery gry (`src/game/cameraRig.js`: `stepCameraRigWarp`,
  zdarzenia `noteCameraRigWarp` z `engageWarp` / `exitWarp`), liczby z `createTripScene`: przy skoku kamera cofa
  się wzdłuż kursu o 140 px × impuls(0,05 / 0,42 s) (szczyt 96 px po 0,11 s; px przy 1080 wierszach, wyżej
  proporcjonalnie) PO sprężynie riga, zoom × (1 − 0,1 · impuls(0,04 / 0,25)); na czas ładowania zoom
  lerp(1, 0,55, smoothstep(ładowanie)) (po ułamku ładowania gry), w skoku ×0,55; przy wyjściu lerp(0,55, 1,
  easeOut³(t / 1,4)) · (1 + 0,1 · impuls(0,03 / 0,18)); drżenie 4 px · smoothstep(0,5, 1, ładowanie). Zoom to
  przejściowy człon log(zoom) sprężyny zoomu (`camera.zoom = zoomBase · e^człon`) — względem zoomu GRACZA
  (kółko w skoku działa, po wyjściu wraca dokładnie do niego), `targetZoom` nietknięty. **Wyprzedzenia 0,26 pół
  ekranu z dema nie ma osobno** — w warpie działa wyprzedzenie riga z prędkości (nawigacja 0,35, walka 0,12 pół
  ekranu; sprężyna 3–8/s, rozpęd warpa 0,9 s), więc statek zostaje przed środkiem kadru ~0,5 s (demo ~0,2 s), a
  po wyjściu wyprzedzenie zostaje, dopóki statek leci (gra nie zatrzymuje statku po wyjściu, demo tak). Ośrodek
  widzi ruch kamery względem statku (`WarpNurt.update`: kamera ośrodka = widoczna droga statku + zmiana offsetu,
  `camFollow` przy kamerze statku bez przejścia) — przy kopie statek odskakuje od drobin, kamera go dogania. Jak w
  demie: bańka dostaje prędkość widoczną STATKU (przepływ kamery + `vRel` = −zmiana offsetu / dt), smugi drobin —
  prędkość kamery, rozciągnięcie gwiazd — prędkość widoczną statku (`player.js`). Pułapka: bańka z prędkością
  kamery (−34 tys. j/s przez pierwsze klatki kopu przy zoomie 0,08) odwracała opływ — przygaszona bańka i warkocz.
  Opcja gracza „Kop kamery przy warpie” (menu → Sterowanie, `OPTIONS.cameraWarpKick`), strojenie `warp*` w
  `cameraRigTune` (F12 → Kamera panel). Tylko gracz 1 (P2 nie ma warpa) i kamera statku; poza nią oddalenie wraca
  do zoomu gracza (RTS bierze `cameraZoomBase`).
- *Przyloty NPC* (`arrivals.js`): warp-in piratów (`npc.state === 'warping_in'`) i wezwania
  (`WarpNurt.arriveAll`) — rozgrywka zna okręt dopiero w chwili pojawienia się, więc wyrzut jest „teraz”
  (bez zwiastuna i rozdarcia przed nim); pełna oś ze zwiastunem przez API (`planArrival` /
  `planFleetArrival` + `attach` — harness, przyszłe wezwania z wyprzedzeniem). Okręt stoi tam, gdzie
  postawiła go gra (w demie wysuwa się o 0,45 L) — ujście jak w demie, odsłanianie w czasie.
- *Odlot NPC*: oś w `warpDrive.js` (`createWarpDeparture` / `sampleWarpDeparture`, 1:1 z dema), efekt
  `WarpNurt.depart(npc, { drive })` — gra dziś nikogo tak nie odsyła (API gotowe).
- *Zgięcie tła*: nie osobny pass, tylko materiał mgławicy (`skyBend.js`) — tło gry to jedna warstwa
  (mgławica, gwiazdy, dół ringu), a gnie się tylko mgławica, jak w demie. Gwiazdy: smugi z `stars.js`.
- *Duszki* (`sprites.js`) z kolanem bloomu (`bloomKnee.js`): bloom gry ma ×3 zgodności z WebGL, którego
  demo nie ma — nadmiar ponad próg ×1/3, żeby poświata brzegów szczelin i błysków była jak w demie.
- *Kadłub*: `uWarpA/B/C` per obiekt w materiale kadłuba (`hullWarp`); żar brzegu z alfy mipmapy sprite'a
  (rozmyty brzeg sylwetki) zamiast SDF cienia — to samo miejsce, bez drugiej tekstury.
- *Plazma WARP* z dysz: `warpPlume3D` gry (`entity.__warpNurtMode` dla NPC), nie duszki dema.
- **Nie przeniesione:** soczewka świata (`worldLens.js` — ciała w widoku skoku; gra rysuje prawdziwy
  świat, punkt wyjścia wyznacza rozgrywka), pokazowe planety / HUD dema.

Integracja (plan sprzed zadania 22): sesja portu WebGPU (`docs/webgpu/PLAN.md`, zadanie 12 — wspólna
infrastruktura efektów w Core3D).

**Wejście z gry.**
- Gracz (`GameState.warp`): ładowanie (0..1) → skok (chwila) → lot (bieg, prędkość widoczna) →
  wyjście (chwila). Liczby z `scenes.js` (`createTripScene`) to specyfikacja: kamera 0,55 zoomu
  przy ładowaniu, kop 140 px / zoom (impuls 0,05 / 0,42 s), wyprzedzenie 0,26 pół ekranu, przy
  wyjściu impuls zoomu +10% i powrót w 1,4 s (w grze od 22-B — „Kop kamery” wyżej; bez osobnego
  wyprzedzenia 0,26); gwiazdy `0,32·ładowanie²` → przestrzał 1,4 → 1 →
  0 w 0,16 s (front 18 000 → −18 000 j. w 0,22 s); przepływ ośrodka w locie 16 / 21 tys. j/s
  (bieg I / II; WIDOCZNY, nie prawdziwa prędkość warpa); `setFade(6)` od wyjścia +0,1 s przez
  1,5 s; soczewka świata jak w propozycji 1 plus: β → 0 w 0,3 s z `(1−u)^2,2`, pozycja statku
  dla soczewki od chwili wyjścia = punkt zatrzymania.
- Przylot NPC: `createWarpArrival` / `sampleWarpArrival` (bez zmian) → `arrivalState` (co klatkę:
  przegródki ośrodka, szczelina, szew ośrodka, zgięcie tła, statek: odsłanianie / smuga / żar,
  błysk, poprzeczna linia blasku, fala, wstrząs). Floty: `planWarpFleetArrival` (bez zmian).
- Odlot NPC: `planDeparture` / `departureState` — nowa oś (ładowanie 1,6 + 0,8·s, szczelina
  przed dziobem od 0,45 s przed wejściem, wejście 0,34 + 0,12·s, zamknięcie 0,45 s); do
  przeniesienia do `warpDrive.js` jako czysta funkcja (jak przylot).

**Gdzie co się dzieje.**
- *Compute*: krok ośrodka (`medium.step`) — jeden dispatch na krok, kotwica = początek przy
  kamerze (`sceneOrigin`), przegródki i szczeliny w uniformach względem kotwicy. Budżet w grze:
  proponuję 0,5–1 mln drobin; krok w demie 1/240 s — 120 Hz NIE był sprawdzany (siły mają `dt`
  jawnie, zapłon i pchnięcia są jednorazowe, ale sprzężenie z przepływem i szczeliny trzeba
  obejrzeć). Krok i draw call można pomijać, gdy nie ma przegródek ani szczelin i wzbudzenie
  wygasło (~3 s po ostatniej).
- *Render ośrodka*: jeden draw call instancji w passie PERSPEKTYWICZNYM pod płaszczyzną gry (głębia
  = paralaksa), addytywnie, po planetach, przed passem ortho.
- *Pass zgięcia tła* (miejsce po passie tła, przed planetami): zgięcie bańki gracza i wciąganie
  tła w szczeliny (`post.js`: `skyBend`) — tylko tło.
- *Post*: fale (przezroczysta refrakcja wszystkich passów, `distort`) — źródła zniekształceń.
- *Pass gry (ortho)*: szczeliny (`rift.js`), błyski, odsłanianie / szew / żar / smuga kadłuba
  (uniformy materiału — pole odległości sylwetki jest w grze: `hullShadowSdf.js`).
- *Gwiazdy*: rozciąganie z przestrzałem i front wyjścia → `StarSystem` gry.

**Zależności**: `starParallax.js`, `bloomConfig.js`, `engineFx.js` (palety `WARP_PLASMA_PALETTES`,
dysze), `ships.js` (rozmiary kadłubów), `warpDrive.js`; plazma WARP z dysz w grze to
`warpPlume3D.js` (w demie duszki blasku); planety i mgławica w grze swoje.

**Tylko pokaz**: planety TSL (w tym obrót tarcz pod kadr), mgławica, duszki blasku, układ
słoneczny i trasy, sceny, HUD.

## Otwarte pytania do usera

1. Czy przylot ma coś robić w grze (np. obrażenia w ujściu szczeliny — „nie stój w tunelu”)?
2. Nić zwiastuna: tylko wizual, czy też znacznik na radarze (rozmiar i kierunek przylotu)?
3. Wyjście przed celem (brzeg tarczy przed dziobem) czy nad tarczą, jak w propozycji 1 (w grze
   z ringiem wygląda inaczej niż w demie)?

Przyjęte w zadaniu 22 (brak notatki integracyjnej — do potwierdzenia przez usera): 1 — efekt czysto
wizualny (wyrzut i ujście szczeliny bez obrażeń); 2 — nić zwiastuna bez radaru; 3 — wyjście przed celem
jak w demie (brzeg tarczy przed dziobem, 260 px przed brzegiem) — dotyczy soczewki świata, której gra
jeszcze nie ma; w grze punkt wyjścia wyznacza rozgrywka (bez zmian).
