# Audyt wydajności — „po ostatnich patchach spadły FPS” (2026-10-11)

Zgłoszenie: zrzut PerfHUD z dużej bitwy — 64 fps, klatka 15,5 ms (p95 22,4), fizyka 6,16 ms (5,96 ms/krok @ 60 Hz),
rysowanie 8,42 ms (U hex 4,37, Core3D 2,82), 138 NPC (35 wrogów / 103 sojuszników), wraki 77 gorących / 71 śpiących /
0 zimnych, 68,5 tys. węzłów kadłubów. „Przed reżyserem kadru też muliło”.

## 1. Odpowiedź w skrócie

1. **Kod nie zwolnił.** Ta sama bitwa na trzech wersjach (dzisiejsze drzewo robocze, HEAD 9def609 z 10.10, 0dc803d
   z 7.10 po optymalizacji renderu) przy tym samym kroku fizyki (60 Hz) i zoomie daje fps w granicach szumu; w scenie
   bez walki dzisiejszy kod jest nawet ~10% szybszy niż 7.10 (tańsze AI z migawki sąsiadów). Dzisiejsze zmiany vs
   HEAD: parami równolegle 232 vs 230 i 216 vs 222 fps (fizyka +4–11% na krok, render równy).
2. **Największe wahania robi TŁO MASZYNY — inne sesje Claude testujące grę.** Ten sam kod i ta sama bitwa: ~147 fps
   na cichej maszynie, 92 fps przy jednej równoległej grze w headless Chrome, 35–53 fps przy dwóch obciążeniach naraz
   (gra + najpewniej benchmark innej sesji). Harnessy biegną bez limitu klatek (`--disable-frame-rate-limit`) — każdy
   zjada cały rdzeń, wspólny L3 7800X3D i czas GPU. Dziś działa 8 sesji; co najmniej jedna (demo belek GPU) puszczała
   benchmarki w headless Chrome w tym samym czasie co moje pierwsze pomiary.
3. **Reżyser kadru (od dziś) kosztuje ~10% w dużej bitwie** przy domyślnym zoomie: oddala kamerę ×0,3 (zoom 0,19 →
   0,09), więc rysuje się cała bitwa. Wyłączony: +12 ± 5 fps.
4. **Rachunek nowych funkcji od 7.10** (radar kokpitu, znaczniki krawędzi, modele dysz SIDE, reżyser) to razem
   ~2 ms/klatkę przy widoku całej bitwy (~15–20% fps). Mniej więcej tyle samo oddała optymalizacja AI — stąd remis
   wersji.
5. **W długiej bitwie rośnie koszt wraków**: ~1 ms/klatkę na każde ~100 wraków, a wraki na belkach nigdy nie
   przechodzą w „zimne” (system zimnych wraków obsługuje tylko heksy) — stąd 77/71/0 na zrzucie.
6. Krok fizyki 60 vs 120 Hz: w tej bitwie fps równe (116 vs 113), płynność klatek (p95/p99) podobna — zmiana kroku
   nie jest przyczyną.

## 2. Metoda

- Prawdziwa gra: Vite + headless Chrome z WebGPU (D3D12), 1920 × 1080, bez limitu klatek, przez CDP. Skład V1:
  50 fregat, 20 niszczycieli, 10 pancerników, 3 supercapitale na stronę (166 okrętów), piraci 7–13,5 km przed
  graczem, Terra Nova za nim, `--seed 7`, zoom 0,1 (cała bitwa w kadrze — jak na zrzucie: „287/0 z 287”), krok
  fizyki 60 Hz we wszystkich wersjach (`?physHz=60`), reżyser kadru wyłączony (`sc_camera_frame=off`), o ile nie
  zaznaczono.
- Trzy kopie kodu w scratchpadzie (`git archive`, drzewo robocze przez tymczasowy indeks — bez dotykania repo),
  każda z własnym Vite i cache.
- Pomiary: (a) `scripts/profil-bitwy-flot.mjs` — próbki PerfHUD co 3 s i profile CPU; nowe opcje: `--ls`
  (localStorage), `--tryb spokoj` (obie grupy Terra Nova, bez walki — koszt na byt bez chaosu bitwy), `--zdarzenia`,
  percentyle czasu klatki z rAF; (b) **`scripts/webgpu/bitwa-przelaczniki.mjs`** (nowe) — w JEDNEJ bitwie na przemian
  fazy bazowe i z wyłączoną funkcją, kanapki E0 – V – E0 (średnia ± SE): koszt pojedynczych funkcji bez wpływu
  różnic przebiegu bitwy i wolnego tła.
- Uwaga z tego dnia: pierwsze pary (ok. 20:42–20:52) szły równolegle z benchmarkiem innej sesji (demo belek) — liczby
  bezwzględne z tych par są ~2–3× gorsze. Potem umowa START/KONIEC przez wiadomości; czysto mierzone: kanapki A/B
  funkcji i reżysera, przebiegi po kolei s1–s7 (do 21:20). Od ~21:20 druga sesja (wg jej późniejszej wiadomości)
  puszczała testy GPU równolegle z resztą serii: 60 vs 120 Hz, wraki, scena bez walki dziś / HEAD i pary. Te serie szły
  na przemian A/B albo parami, więc porównania są ważne, ale liczby bezwzględne z nich mogą być zaniżone, a przy
  rosnącym obciążeniu kolejność H, W, H, W lekko krzywdzi drugą wersję w parze.

## 3. Wyniki

### 3.1 Wersje kodu

Walka (t > 15 s), cicha maszyna, przebiegi po kolei (fps z PerfHUD, w nawiasie pojedyncze przebiegi):

| Wersja | Walka | Podejście (t ≤ 15 s) |
|---|---|---|
| dziś (drzewo robocze) | 148 (149, 146) | 167 (127, 207) |
| HEAD 9def609 (10.10) | 148 (173, 124) | 184 (227, 141) |

(Cztery przebiegi s1–s4 na przemian, 21:07–21:15, cicho. Dzisiejsze przebiegi z serii 60 vs 120 Hz po 21:20 dały
w walce 108 i 124 fps — pod możliwym obciążeniem, poza tabelą.) Rozrzut tej samej wersji między przebiegami to
±20–30% (bitwa chaotyczna, tło). Pary równoległe (obie instancje w tych samych warunkach): dziś 36 vs HEAD 42 (pod
obciążeniem innej sesji), dziś 92 vs 7.10 95 (walka).

Scena bez walki (166 okrętów Terra Nova w szyku, `--tryb spokoj`, t > 15 s) — najmniej zaszumiona:

| Wersja | fps | klatka ms | fizyka ms/krok | rysowanie ms |
|---|---|---|---|---|
| dziś (cicho, 21:15–21:20) | 292 (289, 295) | 3,44 | 2,05 | 2,84 |
| 0dc803d (7.10; 21:17–21:21) | 254 (246, 261) | 4,02 | 3,28 | 3,01 |
| po 21:20, na przemian H, W, H, W | HEAD 313, dziś 279, HEAD 266, dziś 251 | — | HEAD 1,9 / dziś 2,2–2,3 | 2,7–3,2 |
| pary równoległe dziś ‖ HEAD (po 21:20) | 232 ‖ 230, 216 ‖ 222 | 4,33 ‖ 4,35, 4,71 ‖ 4,56 | 2,58 ‖ 2,49, 2,73 ‖ 2,45 | 3,41 ‖ 3,44, 3,61 ‖ 3,60 |

Wniosek: dziś ≈ HEAD (pary równoległe — najpewniejsze; seria na przemian spada z czasem 313 → 279 → 266 → 251, czyli
tło rosło; fizyka dziś może być o 0,1–0,25 ms/krok droższa — ~2% klatki), oba szybsze od 7.10 w fizyce.

### 3.2 Tło maszyny

Ten sam kod (dziś), ta sama bitwa, faza walki:

| Warunki | fps | fizyka ms/krok | rysowanie ms |
|---|---|---|---|
| cicha maszyna, jedna gra | ~147 (146, 149) | 2,9 | 5,3–5,7 |
| + druga gra w headless Chrome | 92 | 4,0 | 8,7 |
| + druga gra + (najpewniej) benchmark innej sesji | 36 | 6,5 | 16,3 |

Rośnie wszystko naraz (fizyka i rysowanie) — to nie GPU, tylko rdzeń, L3 i takt CPU.

### 3.3 Reżyser kadru

`bitwa-przelaczniki.mjs --warianty dirOff --zoom default --faza 7 --ustal 3` (11 kanapek): wyłączony reżyser =
**+12,2 ± 4,8 fps** (+11%), zadania wątku −0,64 ± 0,52 ms/kl, U hex −0,53 ± 0,10 ms; zoom 0,09 → 0,19. Koszt to
cena pokazania całej bitwy (więcej kadłubów, dysz, wież w kadrze). Opcja „Kadr bitwy”: Pełny / Bez zoomu / Wył.

### 3.4 Krok fizyki 60 vs 120 Hz (dziś, po 2 przebiegi)

| | Walka fps | fizyka ms/krok | fizyka ms/s | klatka p95 / p99 [ms] |
|---|---|---|---|---|
| 60 Hz | 116 (108, 124) | 3,1–3,3 | ~190 | 13,8–15,5 / 18,0–20,6 |
| 120 Hz | 113 (118, 108) | 2,1–2,3 | ~260 | 13,2–15,3 / 16,5–21,7 |

60 Hz oszczędza ~25% czasu fizyki na sekundę; przy ~110 fps to w szumie fps. Płynność bez różnicy. (Seria po 21:20,
na przemian 60 / 120 / 60 / 120 — porównanie ważne, liczby bezwzględne prawdopodobnie zaniżone przez testy innej sesji.)

### 3.5 Koszt funkcji w bitwie (kanapki A/B, dziś, zoom 0,1)

E0 średnio: 124 fps, zadania wątku 8,37 ms/kl (fizyka 1,92, rysowanie 5,44 — U hex 2,53, Core3D 1,66, UI 0,45).
Wyłączenie funkcji — zmiana (średnia ± SE, n = 4–5):

| Funkcja (wyłączona) | Zadania wątku ms/kl | fps |
|---|---|---|
| radar kokpitu (rysunek) | **−0,61 ± 0,21** | +9,6 ± 3,1 |
| modele 3D dysz SIDE | **−0,41 ± 0,12** | +8,4 ± 3,6 |
| znaczniki krawędzi | **−0,36 ± 0,14** | +6,3 ± 2,3 |
| maska słońca (shafts) | **−0,37 ± 0,14** | +5,4 ± 2,6 |
| aktualizacja mostków 3D | −1,30 ± 0,69 | +11,5 ± 3,7 |
| mgła wojny | −0,84 ± 0,61 | +6,7 ± 3,9 |
| wieżyczki 2D | −0,54 ± 0,55 | +10 ± 9 |
| światła dysz na kadłubach | −0,15 ± 0,17 | +3,4 ± 3,0 |
| nowe dysze SIDE → stary batch | +0,10 ± 0,16 | −0,5 ± 2,9 |
| pył kosmiczny | 0,01 ± 0,17 | 0 |
| oświetlenie kadłubów: klasyczne | +1,06 ± 1,01 | −10 ± 8 |

Mostki, mgła i wieżyczki — duży rozrzut (zdarzenia bitwy), kierunek pewny, wielkość nie. Nowe dysze SIDE kosztują
CPU tyle co stare.

### 3.6 Wraki

Po bitwie (75 okrętów w szyku + 93 wraki) i po usunięciu wraków (`DevScene.clearWrecks` w kopii):

| | fps | klatka ms | fizyka ms/krok | rysowanie ms |
|---|---|---|---|---|
| z 93 wrakami | 250–270 | 3,7–4,1 | 1,7–1,9 | 3,2–3,4 |
| bez wraków | 340–360 | 2,8–3,0 | 1,15–1,3 | 2,5–2,6 |

(Przebieg po 21:20 — mógł iść obok testów GPU innej sesji; kierunek i rozkład z profili pewne, wielkość przybliżona.)
~10 µs na wrak na klatkę (fizyka + render): `wakeSleepingWrecksNearBodies` (index.html) przegląda śpiące × wszystkie
ciała co krok (~0,2 ms/krok na 100 śpiących), skóry i światła wraków (`updateBeamSkinMesh`,
`syncEntityLightUniforms`), Core3D, mostki wraków. **Wraki na belkach nie zamarzają** (`isFreezeCandidate`,
src/game/coldWrecks.js, wymaga `hexGrid`; etap 3 portu silnika belek) — w długiej bitwie koszt tylko rośnie.

### 3.7 Anatomia klatki (cicha maszyna, walka, profil CPU — dziś)

8,5 ms/kl pod profilerem (118 fps):

- **Rysowanie 5,45 ms (~65%)**: `updateHexShips3D` 2,13 (dysze `EngineVfxSystem` 0,69 — z tego `updateEffects` 0,41,
  `MainExhaust3D.flush` 0,18; skóry belek 0,50 z `syncEntityLightUniforms` 0,22; światła statków 0,31; wieżyczki 2D
  0,17), Core3D 2,11 (pass sceny 1,12 — three `_renderScene` 0,88, zapis slotów kadłubów 0,18; klatka efektów 0,64 —
  rakiety, wybuchy, tarcze, broń; post 0,09), mostki 0,19, radar 0,13, rysunek wież 0,12, przeszkody gazu 0,11,
  tarcze 0,11; do tego kod natywny („(program)”, kanwa 2D i wywołania WebGPU) ~0,9.
- **Fizyka 1,54 ms (~20%)** = 2,98 ms/krok × 0,52 kroku: `npcStep` 0,63 (mózgi AI ~0,35, lot), silnik belek 0,37,
  pociski 0,17.
- HUD kokpitu 0,24, rakiety 0,18.

Pod obciążeniem (pary z innymi grami) te same pozycje rosną 2–3× i dochodzą: `computeAverageBodyColor` 0,8–1,1 ms/kl
(nowe wraki — `getImageData` na wrak), wypiek cieni SDF nowych wraków 0,4–0,9, radar 2,1, znaczniki 1,3–1,8,
`updatePlayerStatusUI` 3,0 ms/kl.

### 3.8 Zrzut użytkownika na tle pomiarów

Najbliższy stan w cichym przebiegu (129–132 NPC, 116–120 wraków, lekka walka): 87–91 fps, fizyka 3,8–4,0 ms/krok,
rysowanie 7,0–7,4 ms. Na zrzucie: 64 fps, 5,96 ms/krok, 8,42 ms — przy 68,5 tys. węzłów kadłubów (u mnie 33–40 tys.:
na zrzucie większe kadłuby i więcej wraków) i nieznanym tle (inne sesje). Fizyka droższa o ~50%, rysowanie o ~15%
— zgodne z cięższą bitwą i/lub obciążoną maszyną, nie z regresją kodu.

## 4. Co gryzie — ranking i poprawki

| # | Co | Ile (bitwa jak wyżej) | Poprawka | Szacowany zysk |
|---|---|---|---|---|
| 1 | Inne sesje testują grę w tym samym czasie | −35…−75% fps | koordynacja START/KONIEC; Chrome harnessów z priorytetem BELOW_NORMAL (`start /belownormal` albo `os.setPriority` przed startem procesów potomnych); bez `--disable-frame-rate-limit` w testach niewydajnościowych | gra gracza nietknięta przez testy |
| 2 | Dysze (`EngineVfxSystem.update`) | 0,7–1,5 ms/kl | LOD na okręt: bez stanu i strug SIDE poniżej ~2 px wylotu; `syncFlightThrusterVisuals` (fizyka, czysty obraz, 30 Hz × każdy NPC) tylko dla okrętów w bańce rysowania | −0,4…−0,8 ms/kl przy oddaleniu |
| 3 | Wraki | ~1 ms/kl na 100 wraków | zimne wraki dla belek (etap 3 portu) albo tani tryb śpiącego wraku w renderze (bez skóry i świateł co klatkę); `wakeSleepingWrecksNearBodies` z listą RUCHOMYCH ciał raz na krok | −1…−1,5 ms/kl w długiej bitwie |
| 4 | Kolor smugi wraku (`computeAverageBodyColor`, hexShips3D.js ×3) | szczyty 0,8–1,1 ms/kl przy wielu nowych wrakach | pamięć koloru per obraz (WeakMap) — wraki dziedziczą obraz rodu | znikają szczyty |
| 5 | Radar kokpitu | 0,61 ± 0,21 ms/kl | stemple napisów duchów (`drawGhosts` → `stampRadarText`; dziś `strokeText` na ducha), rzadszy rysunek w ciężkiej bitwie | −0,2…−0,4 |
| 6 | Modele dysz SIDE | 0,41 ± 0,12 | LOD: bez modelu, gdy dzwon < ~2 px | −0,3 przy oddaleniu |
| 7 | Znaczniki krawędzi | 0,36 ± 0,14 | (już na stemplach) limit liczby / rzadsze odświeżanie odległości | −0,1…−0,2 |
| 8 | Reżyser kadru | ~0,6 ms/kl (+11% fps wył.) | decyzja: domyślnie „Bez zoomu” albo mniejsze oddalenie (`minZoomFactor`) | do +11% fps |
| 9 | Core3D / three (pass sceny, klatka efektów) | 2–2,5 ms/kl | strukturalnie: render w workerze (docs/PLAN-render-worker.md, zmierzone ~2× fps) | ~2× |
| 10 | Drobiazgi „co krok” | ~1 ms/kl pod obciążeniem | rdzenie reaktorów (`finite()` w pętli), czujniki/mgła, integralność gniazd, gospodarka co krok | −0,3…−0,5 |

Punkt 1 tłumaczy „znaczący spadek” najlepiej: tego samego dnia działa 8 sesji, a pojedyncza równoległa gra
w headless Chrome zabiera ~35% klatek. Punkty 2–7 to poprawki kodu bez zmiany rozgrywki.

## 5. Narzędzia

- `node scripts/webgpu/bitwa-przelaczniki.mjs --warianty radar,nozzles,markers,shafts,bridges,fog,turrets,engLights,jetsOld,dust,classic`
  — koszt funkcji w jednej bitwie (kanapki), `--warianty dirOff --zoom default --faza 7 --ustal 3` — reżyser.
- `node scripts/profil-bitwy-flot.mjs --sklad 50,20,10,3 --query physHz=60 --ls sc_camera_frame=off [--tryb spokoj]`
  — przebieg z profilami; porównanie wersji: kopie drzew przez `git archive` w scratchpadzie (junction
  `node_modules`, `cacheDir` Vite w kopii) i przebiegi po kolei przy bezczynnych sesjach albo parami równolegle.
- Pomiar wydajności zawsze przy bezczynnych innych sesjach (wiadomość START/KONIEC) — inaczej liczby bezwzględne są
  2–3× gorsze, a porównania sekwencyjne bezużyteczne.

## 6. Poprawki z § 4, pkt 2–7 — wdrożone i zmierzone (2026-10-11, sesja „Szybkie poprawki wydajności dużej bitwy”)

Kod: worktree `statki/amazing-mahavira-4e2f00` (gałąź `claude/amazing-mahavira-4e2f00`, baza 9def609), bez
commitów; łatki do głównego checkoutu (sprawdzone `git apply --check` po 28a9377) w folderze notatek sesji.
Rozgrywka bez zmian. Każda poprawka ma przełącznik STAREJ ścieżki — A/B w jednej bitwie
(`scripts/webgpu/bitwa-przelaczniki.mjs`, warianty `*Old`).

| § 4 | Poprawka | Pliki | Stara ścieżka |
|---|---|---|---|
| 4 | kolor smugi: pamięć per obraz źródłowy (WeakMap, tylko udane wyniki — obraz w trakcie wczytywania liczy się później); wraki dziedziczą obraz rodu, więc jedno liczenie na typ kadłuba | hexBodyImpostorBatch.js | `averageBodyColorCache.enabled = false` (wariant `colorOld`) |
| 3 | budzenie wraków: ruchome ciała (≥ 15 j/s) raz na wywołanie w Float64Array zamiast odczytu pól wszystkich ciał dla każdego śpiącego wraku; te same wyrażenia — wynik bit w bit (test zgodności z dawną pętlą na 400 losowych scenach, w tym wrak, który po obudzeniu budzi następne) | index.html | `window.__wakeMovers.enabled = false` (`wakeOld`) |
| 5 | radar: napis „?” duchów ze stempli (`stampRadarText`; jeden stempel na poziom alfy, wspólny dla duchów; font ten sam, którym napis szedł dotąd) | radarDisplay.js, radarConfig.js | `RadarTune.stampGhosts = false` (`ghostsOld`) |
| 6 | modele dysz SIDE: LOD przy źródle — EngineVfxSystem nie wpisuje na listę klatki dysz okrętu poniżej progu modelu (próg publikuje rysownik: `SideNozzleFrame.modelMinPx` z `SIDE_NOZZLE3D_HIDE_PX`); paleta dysz bez klucza-napisu na okręt i klatkę | engineVfxSystem.js, sideNozzleFrame.js, shipModels3DGame.js | `SideNozzleFrame.sourceLod = false` (`nozzleOld`) |
| 2 | dysze SIDE bez obrazu (wylot < `minJetPx` albo okręt poza pudłem rysowania dalej niż sięga struga — `SIDE_JET_REACH_R` = 16 R — i wylot < `minLightPx`): sam automat dyszy `SideJets3D.idle` (stan ciągły); flaga `entity.__inDrawBox` z klasyfikacji encji w `updateHexShips3D` | engineVfxSystem.js, sideJets3D.js, hexShips3D.js | `SideJets3D.lod = false` (`jetOld`) |
| 2 | `syncFlightThrusterVisuals` (model dysz w fizyce, czysty obraz) poza pudłem rysowania co 0,25 s z czasem zebranym zamiast 30 Hz — lot bit w bit (test) | shipFlightModel.js | `window.FlightVfxLod.enabled = false` (`flightOld`) |

Obraz: kolor smugi, budzenie i lot — bez zmian; napis ducha — ten sam font i barwa, pozycja zaokrąglona do
piksela i alfa do 1/64 (jak wszystkie stemple tarczy); LOD dysz tylko tam, gdzie nic nie było widać (wylot
< 0,35 px albo struga w całości za kadrem; bez świateł i gazu, więc wspólne limity — np. 48 świateł SIDE na klatkę —
liczą się jak dawniej; źródeł gorącego powietrza takich dysz Core3D i tak nie brał: dysza < 3 px albo spoza kadru).
Testy: `wreckWakeSweep` (zgodność), `sideThrusters3D` (automat bez obrazu = pełna ścieżka, kolejność progów,
zasięg strugi i świateł), `shipFlightModel` (odświeżanie 1/30 s i 0,25 s, lot identyczny), nowy
`impostorColorCache`; `node --test "tests/*.test.mjs"`: 2480 testów, 5 porażek — te same co na czystym HEAD
(demaIndex, playerDefaultLoadout, renderPerfGates ×2, shadowShaftsQuality); `npm run build` przechodzi.

### 6.1 Wyniki (23:09–23:30, cicha maszyna — inne sesje wstrzymane START/KONIEC)

Skład V1 (50 / 20 / 10 / 3 na stronę, fale dosyłane), `--seed 7`, `?physHz=60`, 1920 × 1080. Trzy rodzaje pomiaru:
**(K)** kanapki E0 – V – E0 w jednej bitwie z profilem CPU w każdej fazie — czas łączny funkcji na klatkę (profiler
zawyża czasy ~1,3–1,5×, różnice są ważne); **(M)** mikrobenchmark na zatrzymanej bitwie po ~25 s walki —
`EngineVfxSystem.update` wołane 150× na tych samych encjach, flagach pudła i kamerze, mediana 6 rund, bez profilera;
**(C)** cała klatka — `bitwa-przelaczniki.mjs` (n = 5) i `profil-bitwy-flot.mjs` nowa / stara po kolei.

Stara → nowa ścieżka [ms na klatkę]:

| § 4 | Funkcja | Pomiar | zoom 0,1 | zoom 0,19 |
|---|---|---|---|---|
| 3 | `wakeSleepingWrecksNearBodies` | K, n = 7 | **0,584 → 0,059** (−0,525 ± 0,149; do 138 śpiących wraków) | **0,407 → 0,038** (−0,369 ± 0,115; do 80 śpiących) |
| 6 + 2 | `EngineVfxSystem.update` (oba LOD dysz SIDE) | M | **0,518 → 0,453** (−0,065, −13%) | **0,453 → 0,419** (−0,034) |
| 6 | sam LOD modeli przy źródle (z LOD strug) | M | 0,493 → 0,453 (−0,040) | 0,457 → 0,419 (−0,038) |
| 6 | `syncSideNozzles` | K, n = 7 | 0,033 → 0,000 | 0,017 → 0,005 |
| 2 | sam LOD strug SIDE (z LOD modeli) | M | 0,458 → 0,453 (−0,005) | bez zmian (żadna dysza bez obrazu) |
| 2 | `syncFlightThrusterVisuals` | K, n = 6–7 | **0,155 → 0,106** (−0,049 ± 0,006) | **0,105 → 0,044** (−0,061 ± 0,009) |
| 4 | `computeAverageBodyColor` | na żądanie | 0,057 ms na nowy wrak-smugę → 0,00006 (z pamięci) | — |
| 5 | tarcza radaru, 60 duchów | na żądanie | `render` 0,239 → 0,223 ms na rysunek (30 Hz — ~0,002 ms/kl) | — |

(M) przy zoomie 0,05 (prawie wszystko w pudle, dysze fregat < 0,35 px): 0,411 → 0,333 (−0,078), z czego LOD strug
−0,029, LOD modeli −0,010. Szum (M) ~±0,01 ms (wariant bez zmiany ścieżki przy zoomie 0,19 dał 0,412 vs 0,419).
Przy zoomie 0,1 poza pudłem rysowania było 88–102 ze 167 okrętów, przy 0,19 — 99–116 ze 115–136 w pudle rozgrzania.
W tej bitwie przy zoomie 0,1 nowe wraki prawie nie zostawały smugami (próg 15 px promienia) — `computeAverageBodyColor`
nie trafił do profili ani razu; duchów radaru było 0–7 — pkt 4 i 5 zmierzone na żądanie.

(C) cała klatka — w szumie bitwy: SE 0,1–0,45 ms na klatkę, a znaki poprawek po 0,05–0,1 ms skaczą między
przebiegami (np. zadania wątku dla `nozzleOld` −0,20 ± 0,11 w `bitwa-przelaczniki`, +0,67 ± 0,31 w kanapkach z
profilem; `jetOld` +0,58 ± 0,37 vs −0,77 ± 0,45 — razem z fizyką i radarem, czyli przebieg bitwy, nie dysze).
Spójny jest tylko kierunek dla budzenia wraków: `wakeOld` +0,36 ± 0,15 ms/kl i −5,9 ± 1,8 fps (bez profilera),
+0,86 ± 0,43 / +0,57 ± 0,50 ms w kanapkach z profilem. `profil-bitwy-flot` 60 s, nowa / stara po kolei:
podejście 232 / 223 fps, walka 172 / 178 fps (różne bitwy: rakiety 0,16 / 0,12 ms, GPU 1,37 / 1,12 ms) — w
rozrzucie przebiegów.

Razem (zoom 0,1): późna bitwa ze 100+ śpiącymi wrakami ≈ −0,6 ms/kl (głównie budzenie wraków — dawna pętla
~7 µs na śpiący wrak na klatkę przy ~200 ciałach, nowa ~0,8 µs; obie z narzutem profilera), początek bitwy
≈ −0,1 ms/kl (dysze i model lotu); szczyty od kolorów smug znikają (0,057 ms na każdy nowy wrak-smugę, pod
obciążeniem 2–3× więcej).

Względem szacunku z § 4: budzenie wraków — zgodnie (−0,37…−0,53); dysze (pkt 2) — −0,07 i −0,05 zamiast
−0,4…−0,8, bo szacunek zakładał LOD widoczny na ekranie (bez strug SIDE poniżej ~2 px), a wdrożone są tylko ścieżki
bez obrazu; modele dysz (pkt 6) — −0,04 zamiast −0,3, bo istniejący LOD już ich nie rysował (przy zoomie 0,1
przechodziło 0 z ~330 dysz) — płaciło się za listę i odrzucanie po pracy na okręt; radar (pkt 5) — napis ducha to
~0,3 µs na rysunek, koszt tarczy leży gdzie indziej.

### 6.2 Znalezione po drodze (nie wdrożone)

1. **Limit 48 świateł dysz SIDE na klatkę liczy też dysze za kadrem** (`SideJets3D.push`: `lightsThisFrame++` po
   `lights.point`, które FxLights odrzuca poza kadrem). W dużej bitwie limit jest pełny w każdej klatce, więc część
   widocznych dysz nie oświetla kadłuba. Poprawka: liczyć tylko przyjęte (`if (lights.point(...)) lightsThisFrame++`)
   — zmienia wygląd (więcej świateł na widocznych kadłubach i więcej pracy oświetlenia), więc do decyzji. Z tego
   powodu LOD dysz za kadrem obejmuje tylko dysze poniżej `minLightPx`.
2. **Strugi MAIN okrętów za kadrem** idą do puli 4096 strug i do `MainExhaust3D.flush` (0,21–0,25 ms/kl w
   profilu), a przy zoomie 0,1 ~55–60% okrętów jest poza pudłem rysowania. Pominięcie wypuszczania strug dyszy,
   której struga i iskry nie sięgną kadru (~25 R × długość strugi, iskry ~32 R; moc dalej liczona — pył i światła
   dysz bez zmian), zmniejszy `push` + `flush` i odciąży pulę; do sprawdzenia, czy pula się w bitwie nasyca.
   **Wdrożone 2026-10-12 — § 6.3** (pula się nasyca; decyzja użytkownika: LOD domyślnie włączony, zmienia obraz).
3. Stan dysz z modelu lotu poza pudłem liczy się rzadziej: dysze za kadrem z wylotem ≥ `minLightPx` dalej „biorą”
   limit świateł z pkt 1, tylko w innym rytmie — który z widocznych okrętów dostaje światło, było i jest przypadkowe
   (pierwsze 48 pracujących dysz z listy), średnio bez zmian.
4. Pomiar małych poprawek: cała klatka w chaotycznej bitwie nie rozróżnia zmian < ~0,3 ms (znaki skaczą razem z
   fizyką i radarem); pewne są czasy funkcji z profilu w kanapkach i mikrobenchmark na zatrzymanej bitwie.

### 6.3 Strugi MAIN za kadrem — wdrożone i zmierzone (2026-10-12, sesja „Strugi MAIN za kadrem”)

Kod: worktree `statki/youthful-curie-676a16` (baza 28a9377 + łatki § 6), bez commitu. Dysza MAIN okrętu z
`__inDrawBox === false`, której strugi i iskry wypuszczone w tej klatce nie sięgną kadru w swoim życiu, idzie do
`MainExhaust3D.push` z `pixelRadius = 0` — moc i żar liczą się dalej (EngineFrame: poświata dysz na pyle, światła
dysz na kadłubach, domeny zapłonu, gorące powietrze — bez zmian). Rozgrywka bez zmian.

- Zasięg od wylotu `mainExhaustReach` (`mainExhaust3D.js`) — sufity z liczb `push` / `kick`: struga do 161,6 S·L
  (ogon przy dopalaczu ≈ 25,2 R × `mainLength`) + pół szerokości (uderzenie dopalacza 18 S·W), iskry do 245 S (≈ 38 R —
  iskry uderzenia dopalacza 220 S/s × 1,1 s), plus ruch dyszy względem kadru × życie (rdzeń 0,09 s, ogon 0,32 s,
  uderzenie 0,55 s, iskry 1,1 s) i iskry zostające za lecącym kadrem przez opór (|v| × 0,56 s).
- Kadr (`prepareMainLod`, raz na klatkę, z `cullInfo` — `EngineVfxSystem.update(lista, margines, kadr)`): prawdziwa
  odległość wylotu od prostokąta kadru (po osi), ruch kadru z kamery gry BEZ wstrząsu (`window.camera`, pamięć szczytu
  prędkości 0,4 s, skok > 200 tys. j/s = cięcie), brzeg kadru przy oddalaniu, obrót okrętu (ω × ramię dyszy), zapas =
  margines pudła rysowania (96 px — na przyspieszenia kadru, których prędkość nie przewiduje) + 2 × `shakeMaxPx`.
  Tylko kamera z góry jednego gracza (bez kamer 3D i podzielonego ekranu); w pierwszej klatce z kamerą — bez LOD.
- A/B: `MainExhaust3D.offscreenLod` (domyślnie `true`); pomiar: `MainExhaust3D.jetCount / jetsDropped /
  sparksDropped`, `MainLodStats` (`engineVfxSystem.js`: dysze, poza pudłem, bez strug — liczone też przy `false`).

**Pula strug się nasyca — zmiana OBRAZU (decyzja użytkownika 2026-10-12: LOD domyślnie włączony).** Popyt to ~12,4
strugi na pracującą dyszę (rdzeń 60/s × 0,09 s + ogon 22/s × 0,32 s), więc ~330 dysz wypełnia pulę 4096. W bitwie V1
przy zoomie 0,1 w pudle rozgrzania jest ~420–460 dysz MAIN: pula zapełnia się w trakcie pętli po okrętach i odrzuca
nowe strugi okrętów z końca listy — także tych w kadrze. Sonda (6-s fazy na przemian, V1, seed 7, `physHz=60`):

| zoom | ścieżka | strugi w puli | odrzucone / kl | strug na dyszę w kadrze (pełna = 12,44) | dysz w kadrze z < 8 strugami |
|---|---|---|---|---|---|
| 0,1 | stara | 3896 | 48 (do 72) | **8,43** | **80 ze 195** (na początku bitwy 135 ze 199) |
| 0,1 | nowa | 3071 | 0 | 12,44 | 0,1 |
| 0,19 | stara | 3744 | 25 | 12,15 | 1,0 z 43 |
| 0,19 | nowa | 1041 | 0 | 12,41 | 0 |
| 0,05 | obie | ~1800 | 0 | — | — (wszystkie okręty w pudle rysowania, LOD nie działa) |

Dawny obraz (dysze w kadrze z niepełnymi strugami w dużej bitwie) — `MainExhaust3D.offscreenLod = false`. Iskier
silników udział w banku (55% z 5200) nie wyczerpuje się w żadnym wariancie. Dysz w kadrze zupełnie bez strugi było
i na starej ścieżce mało (~1–5 na ~190 przy zoomie 0,1) — dawny obraz to strugi NIEPEŁNE, nie brakujące.

Koszt [ms/kl]. **(K)** kanapki E0 – V – E0 w jednej bitwie z profilem CPU (n = 18 na zoom, profiler zawyża czasy
~1,3–1,5×); **(M)** mikrobenchmark na zatrzymanej bitwie po 25 s walki: `Fx3D.update` + `EngineVfxSystem.update` ze
stałym dt 1/60 s (60 klatek ustalenia puli na wariant, 150 mierzonych, mediana 6 rund na przemian):

| Funkcja | Pomiar | zoom 0,1 (stara → nowa) | zoom 0,19 |
|---|---|---|---|
| `MainExhaust3D.flush` | K | 0,195 → 0,161 (−0,034 ± 0,005) | **0,187 → 0,056 (−0,131 ± 0,005)** |
| `MainExhaust3D.push` | K | 0,075 → 0,061 (−0,014 ± 0,003) | 0,057 → 0,047 (−0,010 ± 0,002) |
| `EngineVfxSystem.update` (z push / flush; test kadru `mainJetsOffView` 0,010–0,016) | K | 0,852 → 0,833 (−0,019 ± 0,019) | **0,726 → 0,574 (−0,152 ± 0,012)** |
| bank iskier `Fx3D.update` | K | 0,037 → 0,034 (−0,003 ± 0,002) | 0,048 → 0,014 (−0,034 ± 0,003) |
| `updateHexShips3D` | K | w szumie (−0,006 ± 0,052) | 1,539 → 1,364 (−0,175 ± 0,020) |
| `EngineVfxSystem.update` | M | 0,570 → 0,535 (−0,035) | **0,531 → 0,338 (−0,193, −36%)** |
| `Fx3D.update` | M | 0,037 → 0,028 | 0,044 → 0,008 |

Przy zoomie 0,1 zysk jest mały, bo zwolnione miejsca w puli zajmują odzyskane strugi dysz w kadrze (3820 → 3030
strug); przy 0,19 kadr obejmuje mniej okrętów (w pudle rysowania 13 ze 134, w kadrze 25–70 dysz MAIN), więc pula
maleje ~3,6× (3740 → 1040), a wysyłka instancji strug do GPU — o ~2,7 tys. instancji (~115 KB/kl). Cała klatka (K: `frameMs` −0,15 ± 0,09
przy 0,19, −0,31 ± 0,27 przy 0,1) — w szumie bitwy (§ 6.1). Testy: nowy `tests/mainExhaustLod.test.mjs` (lustro liczb
`push` / `kick`; PRAWDZIWY `push` w Node — strugi i iskry z dopalaczem, migotaniem i ruchem 0 / 400 / 3000 j/s nie
wychodzą poza `mainExhaustReach`; decyzja kadru z ruchem, szczytem prędkości, cięciem, oddalaniem, wstrząsem, kamerą
3D i podzielonym ekranem), `sideThrusters3D` (nowa sygnatura `update`); `node --test "tests/*.test.mjs"`: 2484 testy,
5 porażek — te same co w § 6 (demaIndex, playerDefaultLoadout, renderPerfGates ×2, shadowShaftsQuality); build Vite
przechodzi. Narzędzia pomiaru (sonda puli `sonda-strug.mjs`, kanapki z profilem `ab-profil.mjs`, mikrobenchmark
`strugi-mikro.mjs`) — w folderze notatek sesji (poza repo), wzór jak § 6.

Otwarte: przy zoomie 0,1 i większej bitwie (albo bez dalekich okrętów — np. flota w ciasnym kadrze) pula znów może
się nasycić, bo LOD tnie tylko strugi za kadrem. Pula na miarę bitwy (np. 8192 strug — +~0,5 MB CPU i GPU) albo
przydział strug sprawiedliwy między dyszami to osobna decyzja (też zmienia obraz).
