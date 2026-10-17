# Audyt: fizyka w workerze — duże bitwy po wdrożeniu renderu w workerze (2026-10-17)

Zgłoszenie: render w workerze jest trybem domyślnym („jest kop”), ale „w dużych bitwach fizyka dalej lubi opóźniać” —
czy robić worker dla fizyki. Zrzut PerfHUD użytkownika: 159 „fps”, klatka p50 / p95 3,2 / 11,4 ms, fizyka 2,96 ms na
klatkę = **6,82 ms na krok @ 60 Hz**, rysowanie 3,06 ms (U hex 2,07), 145 NPC (70 wrogów / 75 sojuszników),
552 pociski, 46 wraków, 49,8 tys. węzłów kadłubów, „Physics worker: disabled”.

Uwaga do odczytu PerfHUD (od sesji „Audyt wydajności renderowania”, która równolegle bada stronę ↔ worker renderu):
„fps” to 1000 / średni czas WYWOŁANIA `loop()` (praca klatki), nie okres klatki. 159 „fps” = 6,3 ms pracy na klatkę;
prawdziwy rytm wyznacza vsync monitora — u użytkownika 240 Hz (4,17 ms na klatkę). Od audytu renderu z tego samego dnia
(`docs/AUDYT-render-worker-2026-10-17.md`) nagłówek PerfHUD pokazuje prawdziwe kl/s (`display.fpsReal`); `display.fps`
zostaje dla narzędzi.

## 1. Odpowiedź w skrócie

1. **„Opóźnianie” to rytm, nie średnia.** Krok fizyki biegnie 60 razy na sekundę, monitor 240 razy, więc krok wpada
   w co ~4. klatkę wątku gry i na tę jedną klatkę dokłada cały swój koszt: 3–7 ms, szczyty 12–16 ms. Klatki wątku gry
   są dwumodalne — bez kroku ~1,5–2 ms, z krokiem 4–10 ms (zrzut użytkownika: p50 3,2 / p95 11,4). Przy 240 Hz klatka
   ma 4,17 ms: każda klatka z krokiem dłuższym niż ~2,5 ms spóźnia się o vsync i obraz staje na 8–12 ms, do 60 razy
   na sekundę. Zmierzone w prawdziwym oknie z vsync 240 Hz (bitwa 166 okrętów, § 4.3): przed walką wątek gry i worker
   renderu idą równo z monitorem (~238 obrazów na sekundę), w walce wątek gry robi 159–202 klatki na sekundę, a worker
   renderuje każdą stronę i czeka na następną — brakuje ~60 obrazów na sekundę, tyle, ile kroków fizyki. Klatki wątku
   gry z krokiem trwają 5,9 ms (p50) / 8,8 ms (p95), bez kroku 1,8 / 2,8 ms. U użytkownika (krok 6,8 ms + 3,3 ms reszty
   ≈ 10 ms) chybia każda klatka z krokiem: z liczb zrzutu wychodzi ~138 prawdziwych klatek na sekundę przy monitorze
   240 Hz, rytm 4 / 12 / 4 / 12 ms (§ 4.5). Bez fizyki na wątku gry model daje < 0,5% chybień w obu bitwach (§ 4.2).
2. **W kroku nie ma jednego winnego** (§ 3): AI 41–52% (mózgi 20 Hz, skan broni, sąsiedzi, lot NPC), pociski i trafienia
   16–24%, silnik belek 14–15%, rakiety 2–4%, reszta po 1–4% (gracz, świat, czujniki, integralność, kolizje). Worker dla
   samego silnika belek nie zmienia rytmu — to 1/7 kroku, a gra pyta go synchronicznie z ~100 miejsc (§ 5.3).
3. **Rytm naprawia tylko CAŁA symulacja poza wątkiem gry** (§ 6 A): wątek gry zostaje z klatką ~1,5–2,5 ms bez skoków
   (240 Hz bez chybień z powodu fizyki), symulacja dostaje własny rdzeń — budżet kroku 16,7 ms zamiast ~2,5 ms, czyli
   3–5× większe bitwy, zanim gra zacznie zwalniać; szczyty (rozpady budowli, szyja habitatu: 2–4 kroki × 10–14 ms —
   `AUDYT-przestoje-2026-10-15.md`) przestają zamrażać obraz, kamerę i interfejs. Następnym ogranicznikiem przy 240 Hz
   będzie wtedy worker renderu (CPU klatki 2,5–3,5 ms w walce, szczyty 4,3–4,5 ms).
4. **Koszt — rząd wielkości projektu „render w workerze”, ale trudniejszy** (§ 5): rdzeń symulacji to 378 funkcji /
   ~8,9 tys. linii głównego skryptu `index.html` (razem z panelami stacji osiągalnymi z kroku — 552 / 12,7 tys.), w nim
   155 odwołań do UI (komunikaty, stan stacji, HUD), 26 odczytów wejścia (klawisze, kursor) i 7 dźwięku; 82 moduły
   symulacji (42 z nich czyta `window` — 352 razy); w drugą stronę ~900 odczytów stanu symulacji w renderze, UI
   i obsłudze wejścia, 46 akcji wejścia i 67 nasłuchów DOM pisze stan wprost; narzędzia harnessu czytają grę w stronie.
   Szacunek: 25–35 zadań jak RW-01…RW-45, ale bardziej sekwencyjnych (jeden plik `index.html`) — dłużej.
5. **Najpierw — bez workera, w dniach** (§ 6 D, E): tańszy krok (szacunek z profilu −15–20%) i rozłożenie pracy
   decyzyjnej (mózgi AI 20 Hz, integralność, czujniki, UI) na klatki BEZ kroku — klatka z krokiem −30–45%. Wystarczy na
   bitwy rzędu 166 okrętów (wątek gry ~12 ms pracy na 1/60 s — przy równym rozłożeniu mieści się w 240 Hz); przy kroku
   użytkownika 6–7 ms i 3,3 ms reszty klatki to ~20 ms pracy na 1/60 s — wątek gry jest przeciążony dla 240 Hz przy
   każdym rozłożeniu (sufit ~180 kl/s). Po etapie 0 pomiar w oknie 240 Hz i decyzja o workerze symulacji (§ 7, § 8).
6. **120 Hz nie pomaga** (§ 4.4): krok przy 120 Hz kosztuje prawie tyle samo co przy 60 Hz (2,4–4,2 ms; tanieją tylko
   mózgi AI) — fizyka zjada ~2× więcej CPU, model: 240 Hz 34% klatek spóźnionych (60 Hz: 27%), 144 Hz 12% (60 Hz: 2,2%).
7. **Przy okazji** (przekazane sesji audytu renderu, obie rzeczy już u niej w drzewie roboczym, bez commita):
   (a) w bitwie 331 okrętów obraz workera renderu STAWAŁ od ~18 s do końca — wyjątek mostków na ciele lustra bez
   kratownicy w `renderPage` co klatkę; poprawka sprawdzona tym samym przebiegiem (§ 4.6); (b) okręty NPC szły do obrazu
   w pozie ostatniego kroku 60 Hz bez interpolacji — przy 240 Hz kadłub przesuwał się co ~4 klatki przy płynnej kamerze
   (osobna przyczyna „szarpania”, § 6 G) — interpolacja w toku.

## 2. Metoda

- Prawdziwa gra w trybie renderu `worker` (domyślny gracza), krok fizyki 60 Hz (domyślny), Vite + Chrome z WebGPU
  (RTX 5080, Ryzen 7 7800X3D) przez CDP. Maszyna cicha (`nvidia-smi` 1%, procesy tła < 3% CPU), pomiary uzgadniane
  z sesją audytu renderu (START / KONIEC).
- Bitwy jak w `scripts/profil-bitwy-flot.mjs`: **V1** 50 / 20 / 10 / 3 (fregaty / niszczyciele / pancerniki /
  supercapitale) na stronę = 166 okrętów, **2 × V1** 100 / 40 / 20 / 6 = 331 okrętów; seed 7, zoom 0,45, pustka między
  Wenus a Ziemią, gracz nieśmiertelny. Floty zbliżają się ~35 s (V1) i ~70 s (2 × V1) — fazy liczone od pojawienia się.
- **`scripts/fizyka-kroki.mjs`** (nowe) — bez zmian w grze: opakowania `PerfHUD.markPhysicsStep` / `addTiming` /
  `recordFrameTime` w stronie, więc rejestr KAŻDEGO kroku z kubełkami PerfHUD (AI, pociski, gracz, świat, integralność…)
  plus opakowane `HullBodies.step`, `worldBodies.step`, `rocketSystem3D.step`; każda klatka `loop()` (czas, liczba kroków,
  fizyka); okresy rAF i CPU wszystkich wywołań rAF; longtask; profile CPU w oknach. Tryb headless bez limitu klatek
  (koszty) albo `--okno 1` (prawdziwe okno z vsync — jak u gracza).
- **`scripts/fizyka-kroki-analiza.mjs`** (nowe) — tabele faz, rodzaje kroków, klatki z krokiem i bez, model vsync
  (klatka = „reszta” pracy wątku z klatek bez kroku + kolejne zmierzone kroki; rAF w następnym vsync po końcu pracy),
  `--profil` — drzewo `physicsStep` z profilu CPU.
- **`scripts/szew-symulacji.mjs`** (nowe) — inwentarz statyczny szwu symulacji (AST głównego skryptu `index.html`,
  osiągalność funkcji z `physicsStep`, odwołania do DOM / UI / dźwięku / wejścia / `window`).
- Koszty kroku w headless i w oknie z vsync zgadzają się (±10%, § 4.3). Okresy klatek liczą się tylko w oknie: w headless
  bez limitu klatek znaczniki rAF to kolejne BeginFrame, a nie vsync. Rytm obrazu w oknie mierzę licznikiem złożeń
  workera renderu (`RenderWorkerHost.composed` — każde złożenie to nowy obraz na ekranie); okresy rAF wątku gry
  pokazują tylko część spóźnień (klatka z krokiem trwa 5,9 ms, a jej okres rAF ma p50 4,18 ms — znacznik to vsync, nie
  chwila wywołania).

## 3. Koszt kroku fizyki

### 3.1 Fazy bitwy (headless, ms na krok)

| | spokój | V1 podejście (0–35 s) | V1 walka (35–60 s) | V1 walka (60–75 s) | V1 wraki (75–92 s) | 2 × V1 podejście (0–40 s) | 2 × V1 walka (≥ 70 s) |
|---|---|---|---|---|---|---|---|
| średnia | 0,24 | 2,39 | 2,86 | 4,17 | 3,41 | 4,09 | 5,21 |
| p50 | 0,22 | 2,23 | 2,73 | 4,05 | 3,24 | 3,75 | 4,85 |
| p90 | 0,28 | 3,00 | 3,58 | 5,11 | 4,48 | 5,49 | 7,71 |
| p99 | 0,39 | 5,27 | 4,77 | 6,73 | 6,02 | 8,00 | 10,35 |
| maks. | 4,49 | 11,95 | 12,86 | 14,55 | 7,46 | 13,24 | 15,79 |
| NPC / pociski / wraki | 0 / 0 / 0 | 166 / 46 / 0 | 157 / 202 / 10 | 129 / 453 / 37 | 89 / 280 / 77 | 331 / 28 / 1 | 314 / 316 / 16 |

Zrzut użytkownika (6,82 ms / krok przy 145 NPC i 552 pociskach) odpowiada górze tego zakresu — 2 × V1 w walce albo
V1 w najgęstszej walce przy obciążonej maszynie (ten sam rząd co zrzut z `AUDYT-wydajnosc-2026-10-11.md`: 5,96 ms / krok
przy 138 NPC).

### 3.2 Na co idzie krok (headless)

| podsystem | V1 walka (t ≥ 35 s, 3,37 ms) | V1 60–75 s (4,17 ms) | 2 × V1 walka (5,21 ms) |
|---|---|---|---|
| AI: mózgi 20 Hz (1/3 na krok), skan broni i wybór celów, sąsiedzi (unik, separacja), lot NPC, eskadry, misje | 1,41 (42%) | 1,69 (41%) | 2,72 (52%) |
| pociski i trafienia (pętla pocisków z zapytaniami silnika belek, PD gracza, strzały NPC) | 0,69 (21%) | 1,00 (24%) | 0,83 (16%) |
| silnik belek (`HullBodies.step`: kolizje, solver lokalny, integralność ciał) | 0,51 (15%) | 0,58 (14%) | 0,80 (15%) |
| rakiety (lot, D2 — w kroku od RW-23) | 0,14 (4%) | 0,19 (4%) | 0,10 (2%) |
| gracz: kierowanie ogniem, broń, lot, warp | 0,14 (4%) | 0,17 (4%) | 0,07 (1%) |
| świat: strefy, orbity, gospodarka, stan UI stacji, infrastruktura | 0,11 (3%) | 0,12 (3%) | 0,11 (2%) |
| skan pod kursorem, UI skanera i namiaru, czujniki / mgła, CIC (raz na klatkę) | 0,09 (3%) | 0,11 (3%) | 0,16 (3%) |
| rój naprawczy, ciała świata, baza, rdzenie, listy ciał | 0,09 (3%) | 0,11 (3%) | 0,13 (2%) |
| integralność gniazd (co 3. krok) | 0,07 (2%) | 0,09 (2%) | 0,16 (3%) |
| kolizje z pasem, kometami, ringiem, wydobycie, wraki, reszta | 0,10 (3%) | 0,12 (3%) | 0,13 (2%) |

AI rośnie szybciej niż liczba okrętów (166 → 331 okrętów: mózgi 0,70 → 1,37 ms / krok, sąsiedzi 0,16 → 0,31). Pociski
i silnik belek rosną z walką (pociski w locie, wraki), nie z liczbą okrętów.

### 3.3 Rodzaje kroków (V1, walka)

Kroki są równe — takt AI (co 3. krok przy 60 Hz) i integralność (co 3. krok) nie robią osobnych szczytów:

| krok | n | średnia | p95 | maks. |
|---|---|---|---|---|
| z taktem AI 20 Hz | 1141 | 3,42 | 5,07 | 14,55 |
| bez taktu AI | 2281 | 3,34 | 4,95 | 12,86 |
| z integralnością | 1140 | 3,44 | 5,12 | 9,65 |
| bez integralności | 2282 | 3,33 | 4,89 | 14,55 |

Mózgi chodzą fazami (1/3 okrętów na krok), więc koszt AI rozkłada się po krokach już dziś — ale wszystko, co jest
w kroku, spada w tę jedną klatkę wątku gry, w której wypada krok.

### 3.4 Profil CPU (najdroższe funkcje, ms na krok; profil podnosi koszt ~10%)

V1, t = 65–70 s, `physicsStep` 4,5 ms / krok: `npcStep` 1,74 (mózgi `npc.ai` ~1,1, model lotu 0,30, starty myśliwców
z hangarów 0,09), `bulletsAndCollisionsStep` 1,09 (pętla własna 0,45, CIWS × rakiety 0,15 — każdy pocisk CIWS przegląda
wszystkie rakiety strony przeciwnej, promienie tarcz 0,06 + 0,06, siatka pocisków 0,09), `HullBodies.step` 0,60,
`rocketSystem3D.step` 0,26, kierowanie ogniem 0,13, czujniki (mgła) 0,10, integralność 0,07, rdzenie 0,05,
`InfrastructureUI.updateInfrastructureState` 0,05, budzenie wraków 0,05, komety i ring 0,05.

2 × V1, t = 85–90 s, 5,45 ms / krok: `npcStep` 2,58 (mózgi ~1,8, model lotu 0,38, starty myśliwców 0,15), silnik belek
0,87, pociski 0,95 (promienie kolizji pocisków 0,14), integralność 0,13, czujniki 0,13. Self: jądra sąsiedztwa AI
(`trafficAvoidanceSnapshot` 0,18, `selectRanges` 0,12, `applySeparationForces` 0,12, `capitalObstacleSpeedCap` 0,08),
`processAutonomousWeapons` 0,29, `buildShipScanCache` 0,10, odczyty tarcz i profilu kadłuba (`entityUsesHullShield` 0,09,
`ensureShield` 0,06, `resolveEntityHullProfileId` 0,06), `pairFilter` silnika belek 0,08, `performance.now` (liczniki
PerfHUD) 0,07.

## 4. Rytm klatek wątku gry

### 4.1 Klatki `loop()` z krokiem i bez (V1, walka, headless)

| klatka | udział | `loop()` p50 | p95 | maks. | bez fizyki p50 |
|---|---|---|---|---|---|
| bez kroku | 71,6% | 1,70 | 2,61 | 10,0 | 1,70 |
| 1 krok | 28,1% | 5,33 | 8,05 | 18,4 | 2,10 |
| 2 kroki | 0,3% | 9,38 | 12,08 | 13,4 | 2,45 |

Średnio na klatkę: `loop()` 2,91 ms = fizyka 0,96 + reszta 1,94 (pakowanie migawki, wieże, maskowanie, nakładki 2D,
UI). Reszta to wszystko, co zostałoby na wątku gry przy symulacji w workerze (plus odczyt jej strony, § 6 A).

### 4.2 Model vsync

Klatka = „reszta” pracy wątku gry (losowana z klatek bez kroku) + kolejne zmierzone kroki; rAF w następnym vsync po
końcu pracy. Odsetek klatek spóźnionych (okres > 1 vsync), w nawiasie „bez fizyki na wątku gry”:

| | 144 Hz | 165 Hz | 240 Hz |
|---|---|---|---|
| V1, 60 Hz (headless) | 2,2% (0%) | 6,7% (0%) | 27,3% (0,1%) |
| V1, 60 Hz (okno z vsync, § 4.3) | 4,7% (0%) | 12,0% (0%) | 31,9% (0,3%) |
| 2 × V1, 60 Hz (headless) | 5,5% (0%) | 11,5% (0%) | 33,5% (0,2%) |
| V1, `?physHz=120` (headless) | 12,0% (0%) | 23,9% (0%) | 34,3% (0,5%) |

Model nie zna pracy poza `loop()` (składanie bitmap workera, GC, zadania długie). Dla okna 240 Hz daje 181 klatek na
sekundę — tyle, ile zmierzonych złożeń workera w walce (151–197, średnio ~180, § 4.3): brakujące obrazy wyjaśnia sam
wątek gry z krokiem.

### 4.3 Okno z vsync 240 Hz

`node scripts/fizyka-kroki.mjs --okno 1` — bitwa V1, tryb `worker`, okno 1280 × 720 na monitorze 240 Hz, 80 s. Drzewo
robocze z interpolacją póz NPC sesji audytu renderu w toku (`src/game/renderPoses.js` — praca w `render()`, nie
w kroku).

Krok (ms): 2,22 (0–15 s, podejście), 2,62 (15–30 s), 3,94 (30–50 s, walka: 440 pocisków, 20 wraków), 3,63 (≥ 50 s,
wraki); p99 4,7–7,8, maks. 7,4–11,8 — jak w headless (§ 3.1). Rozkład na podsystemy też ten sam.

| klatka `loop()` (t ≥ 35 s) | udział | p50 | p95 | maks. |
|---|---|---|---|---|
| bez kroku | 70,6% | 1,76 | 2,77 | 9,8 |
| z krokiem | 29,4% | 5,85 | 8,81 | 21,2 |

Złożenia workera renderu na sekundę (nowe obrazy na ekranie):

| t [s] | 6–15 | 18 | 21 | 24 | 27 | 30 | 33 | 36 | 39 | 42 | 45 | 48 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| złożeń / s | 240 | 234 | 231 | 225 | 209 | 197 | 175 | 151 | 185 | 175 | 185 | 194 |
| pociski | 0–96 | 20 | 94 | 39 | 112 | 452 | 329 | 401 | 511 | 572 | 468 | 438 |

Przed walką obraz idzie równo z monitorem; w walce brakuje 45–90 obrazów na sekundę — średnio ~60, tyle, ile kroków
fizyki. Model vsync z tych samych klatek (§ 4.2) daje 181 klatek na sekundę.

Kto gubi obrazy — drugi przebieg w oknie z licznikami workera renderu (`RenderWorkerHost.stats`, różnice między próbkami
co 3 s):

| | przed walką (t 6–30 s) | walka (t 33–63 s) | wraki (t 66–75 s) |
|---|---|---|---|
| klatki wątku gry / s | 218–238 | 159–202 | 212–222 |
| rendery workera = złożenia / s | 215–238 | 147–196 | 205–216 |
| takty workera bez renderu (czeka na stronę) / s | 68–102 | 43–75 | 81–94 |
| CPU klatki workera [ms] | 2,2–3,2 | 2,5–3,5 (szczyty 4,3–4,5) | 2,5–4,3 |
| GPU klatki [ms] | 0,3–0,9 | 0,7–1,6 | 1,6–2,2 |

Worker renderuje KAŻDĄ stronę, którą dostanie, i czeka na następną — obrazów brakuje, bo wątek gry w walce robi
159–202 klatki na sekundę zamiast 240, czyli gubi ~1 vsync na każdy krok fizyki. Worker ma zapas (CPU klatki
2,5–3,5 ms), ale w szczytach dochodzi do budżetu 4,17 ms — po zdjęciu fizyki z wątku gry to on będzie następnym
ogranicznikiem przy 240 Hz (domena audytu renderu).

Pomiar sesji audytu renderu w tym samym oknie (wcześniejsza, lżejsza faza bitwy, krok śr. 2,3 ms): 3,9% okresów rAF
≥ 2 vsynce. Przy lekkim kroku klatka z krokiem (1,5 + 2,3 ≈ 3,8 ms) jeszcze się mieści w 4,17 ms, przy krokach walki
(3,5–4 ms) już nie — a okresy rAF i tak zaniżają spóźnienia (§ 2).

### 4.4 Krok 120 Hz (`?physHz=120`) — skreślony

Ta sama bitwa V1 przy 120 Hz: krok 2,35 / 3,84 / 4,19 / 3,11 ms (fazy jak w § 3.1) — prawie tyle samo co przy 60 Hz.
Tanieją tylko mózgi (faza 1/6 okrętów na krok zamiast 1/3; zmierzone −20–40%), a pociski, silnik belek, lot NPC
i rakiety kosztują tyle samo na krok niezależnie od jego długości (w tym przebiegu walka była gęstsza — bitwa jest
chaotyczna; z rozbicia na części krok przy 120 Hz wychodzi ~10–15% tańszy). Wynik: fizyka 3,20 ms na klatkę zamiast
0,96, krok w 66% klatek (2 kroki — 6,8%, 3 — 2%), `loop()` 6,1 zamiast 2,9 ms; w modelu vsync gorzej przy każdej
częstotliwości (§ 4.2). W pomiarze z 2026-10-07 krok przy 120 Hz był ~25% tańszy niż przy 60 Hz (4,38 wobec 5,8 ms) —
AI było wtedy większą i droższą częścią kroku (przed migawką sąsiadów). Wniosek: 60 Hz zostaje, a 120 Hz ma sens dopiero
w workerze symulacji, gdzie CPU fizyki nie zabiera klatek (§ 8 D2).

### 4.5 Zrzut użytkownika

Fizyka 2,96 ms / klatkę przy 6,82 ms / krok = krok w 43% wywołań `loop()`; reszta pracy ~3,3 ms. Skoro kroków jest 60
na sekundę, wywołań `loop()` było ~138 na sekundę (60 ÷ 0,434) — to jest prawdziwa liczba klatek w chwili zrzutu, przy
monitorze 240 Hz (co ~2. vsync powtarza poprzednią klatkę). Klatka z krokiem ≈ 10 ms ≈ 2,4 vsynca, klatka bez kroku
3,3 ms mieści się w jednym: rytm 4 / 12 / 4 / 12 ms zamiast równych 4,17. To jest odczuwane opóźnianie; „159 fps”
(średni czas pracy klatki) go nie pokazuje.

### 4.6 Błąd workera renderu w bitwie 331 okrętów (przekazany sesji renderu)

Bitwa 2 × V1, tryb `worker`: od ~18 s do końca licznik złożeń `RenderWorkerHost.composed` stoi (4359) — obraz 3D
zamarza, wątek gry i fizyka biegną dalej. Konsola workera co klatkę: `TypeError: Cannot read properties of null
(reading 'count')` w `_latticeIndex` (`src/game/destructorBeams3D.js:3006`) ← `bridgeCellNode`
(`src/game/shipBridgeBeams.js:83`) ← `createBeamBridgeRecordCore` / `Bridge3D._createRecord` (`src/3d/bridge3D.js`)
← `renderPage` (`src/render/render.worker.js:772`), drugi wariant przez `beamWindowNode` ← `BridgeFx3D.update`. W tej
chwili w bitwie był pierwszy wrak. Dwie rzeczy: ciało lustra bez kratownicy (topologia jeszcze nie doszła) i to, że
wyjątek jednego modułu w `renderPage` zatrzymuje CAŁY obraz. Liczby z poziomu klatek tego przebiegu (§ 4.2, wiersz
2 × V1) liczą się bez złożeń — koszty kroku są ważne.

Sesja audytu renderu poprawiła to w drzewie roboczym (slot ciała z nową generacją → topologia od nowa, osłona mostków na
lustrze bez węzłów, wyjątek modułu nie zatrzymuje klatki — jeszcze bez commita). Sprawdzenie tym samym narzędziem
(`node scripts/fizyka-kroki.mjs --sklad 100,40,20,6 --trwanie 40`): złożenia rosną przez cały przebieg (pierwszy wrak
~30 s), konsola bez błędów.

## 5. Czym jest „fizyka” w kodzie — szew symulacji

### 5.1 Sekcje `physicsStep` (`index.html`)

| sekcja (kubełek PerfHUD) | co robi | ms / krok (V1 60–75 s) | dla workera |
|---|---|---|---|
| świat (`worldZoneTime`) | cel kamery (`updateCameraTarget`), stan UI stacji, `InfrastructureUI.update*`, gospodarka stacji, ładunki, złom, czas gry, orbity planet i stacji, trasy warpa, tarcze stacji, strefy, paliwo | 0,12 | kamera i UI → wątek gry, reszta → symulacja |
| systemy gracza (`playerSystemsTime`) | rozkaz ataku, kierowanie ogniem (kursor w świecie), broń specjalna, tarcza, gracz 2, wyrzutnie, `screenToWorld(mouse)` (kamera!), zwinność | 0,13 | wejście (kursor w świecie) jako dane kroku |
| skan i UI (`scanUiTime`, raz na klatkę) | skan pod kursorem (podpowiedź w DOM), UI skanera i namiaru, drony zwiadu, `SensorSystem` (mgła wojny), CIC | 0,11 | UI → wątek gry, mgła i drony → symulacja |
| lot gracza (`playerFlightTime`) | TRAVEL TO, rozkazy, kurs warpa, silniki, system F, postawa, napęd z wejścia (`Input.keyHeld`), całkowanie, rampa warpa, blokada fabuły, `SimClock.advance`, lot rakiet; kamera gracza 2 (`camera2` = poza P2 w kroku — przez to tło podzielonego ekranu drga, a P2 nie dostał interpolacji, audyt renderu) | 0,04 + 0,19 | wejście lotu jako dane kroku; kamera 2 → `render()` z pozą interpolowaną |
| wraki (`wreckPrepTime`) | odłamki, zimne wraki, budżet wraków | 0,04 | symulacja |
| AI (`aiTime`) | eskadry, kolejka startów, skrzydło (`updateSupportWing` pisze DOM), holownik, fregata zwiadu, `npcStep` (mózgi, lot NPC, sąsiedzi), bomby, holowanie, megafrachtowce, misje piratów | 1,69 | symulacja |
| pociski (`projectileTime`) | PD gracza, pociski i trafienia (`HullBodies.sweep / impact / probe`), strzały NPC | 1,00 | symulacja (dźwięk trafień → zdarzenia) |
| kolizje (bez kubełka) | olbrzymy pasa, komety, ring, wydobycie, holowanie, megafrachtowce | 0,07 | symulacja |
| silnik belek (`destructiblePrepTime` + `destructorTime`) | listy ciał, budzenie wraków, rój naprawczy, ciała świata, `HullBodies.step`, baza piratów, szyja, rdzenie | 0,69 | symulacja |
| integralność (`hardpointTime`, co 3. krok) | gniazda, sufit punktów, dym zgniotu | 0,09 | symulacja |
| HUD nawigacji (`hudNavTime`) | HUD | 0,001 | wątek gry |

Rusztowanie `src/physics/` (`PhysicsBridge` pod `?workerPhysicsV2` — stąd „Physics worker: disabled” w PerfHUD)
powstało pod stary silnik heksów i nic go nie zasila (tylko `step` bez ciał); flaga wymusza krok 120 Hz. Nie nadaje
się na fundament — do usunięcia albo zignorowania.

### 5.2 Liczby szwu (`scripts/szew-symulacji.mjs`)

- Główny skrypt `index.html`: 32,4 tys. linii, 1169 funkcji lokalnych, 828 importów.
- Osiągalne z `physicsStep` (po identyfikatorach — z góry): **552 funkcje, 12,7 tys. linii**; w nich DOM 422 (prawie
  wszystko z budowniczych paneli stacji osiągalnych przez `updateStationUIState` → `openStationUI` → `renderStationUI`),
  UI 227, dźwięk 11, wejście 26, `window` 155.
- **Rdzeń** (bez schodzenia w funkcje z DOM i budowniczych paneli): **378 funkcji, 8,9 tys. linii**, 10 granic UI
  (`updateHoverInfo`, `hideHoverInfo`, `openStationUI`, `renderStationOverlay`, `setStationEditorMode`,
  `pushZoneMessage`, `pushSpecialChargeMessage`, `toast`, `playDynamicSound`, `updateSupportWing`); w rdzeniu UI 155
  (`pushZoneMessage` ×69, odczyty `stationUI` ×46, `InfrastructureUI` ×18, `hudSystem` ×10, `CICDisplay` ×4…), dźwięk 7,
  wejście 26 (`Input.keyHeld` ×17, `mouse.x/y` ×6, gałka, `manualFlight`), `window` 97, rozkazy renderu 57
  (`RenderCommands`, `HullDamageEvents`, `GameBlasts` — strumień już jest, pierścień SPSC przeniesie się z pisarzem),
  `Math.random` 24, `performance.now` 84 (liczniki PerfHUD).
- Moduły importowane z kroku: 82 symulacji (`src/game`, `src/ai`), 7 UI, 7 renderu, 16 danych. W modułach symulacji
  `window.` 352 razy w 42 plikach (najwięcej `capitalAI.js` 66, `fighterAI.js` 59, `weaponController.js` 26,
  `rocketSim.js` 26), `document.` 8 razy w 4, `localStorage` 27 razy w 12.
- W drugą stronę (stan symulacji czytany poza krokiem — lustra na wątku gry): `render()` i funkcje osiągalne tylko
  z niego — 143 funkcje / 5 tys. linii, 458 odczytów w 57 funkcjach; pozostałe (obsługa wejścia, UI, panele, inicjalizacja)
  — 368 funkcji / 5,7 tys. linii, 449 odczytów w 133 funkcjach.
- Pisarze stanu spoza kroku (rozkazy): 46 akcji `GameActions`, 67 nasłuchów DOM (`click`, `mousedown`, `wheel`…) w
  `index.html`, panele stacji (handel, wyposażenie, hangar, naprawa, ładunki), kokpit (wsparcie, rozkazy, formacje), CIC
  (TRAVEL TO, dron), RTS, fabuła (ODDOKOWANIE).
- Narzędzia: ~100 skryptów `scripts/` i `scripts/webgpu/` czyta i pisze grę przez `evaluate` w stronie (`window.npcs`,
  `spawnCallInShip`, `DevScene.*`, `__setGamePaused`…).

### 5.3 Silnik belek jako osobny worker

`HullBodies` to ~25 funkcji używanych z gry, ~100 miejsc wywołań w `index.html` i `src/` — zapytania synchroniczne
(`probe` 28, `impact` 15, `sweep` 8, `surfaceNormal`, `structuralState`, `hasContact`, `overlaps`, `nodeWorld`,
`cellWorld`, `traceThrough`, `solidLatticeAt`…) i haki w trakcie kroku (`onImpact` 15, `onNodeLost` 10, `onDebris`,
`onRegrow`, `onRepair`, `onWorldIsland`, `onSolidNodeLost`). Pętla pocisków co krok pyta silnik i od wyniku zależy
przebicie, rykoszet, rzaz i obrażenia; gra całkuje ruch encji, a `HullBodies.step` synchronizuje ciało w obie strony.
Worker samego silnika = te wywołania asynchroniczne z opóźnieniem kroku (zmiana zachowania broni i taranu) dla zysku
0,5–0,8 ms / krok w bitwie. Wyjątek: sceny zniszczeń (szyja habitatu, rozpady) — tam silnik to większość kroku, ale
to osobny problem (solver lokalny na GPU — `docs/webgpu/FIZYKA-BELEK-GPU.md`).

### 5.4 Co zostaje na wątku gry przy symulacji w workerze

Wejście (klawiatura, pady, mysz), UI w DOM (kokpit, stacja, menu, dziennik), dźwięk (WebAudio nie ma w workerze),
kamera (rig, reżyser kadru, kamery 3D, ujęcia fabuły — kursor i poza gracza), nakładki 2D, składanie obrazu B2cr
(bitmapa workera renderu + nakładki tej samej klatki) i pakowanie migawki renderu — dziś ~1,5–2 ms na klatkę (§ 4.1).

## 6. Warianty

### A. Cała symulacja w workerze — docelowo

Trzy wątki: **wątek gry** (wejście, UI, dźwięk, kamera, nakładki, składanie), **worker symulacji** (`physicsStep` i
wszystko, co osiąga, własny zegar 60 Hz), **worker renderu** (jak dziś).

- Wątek gry → symulacja: pierścień rozkazów na SAB (SPSC, wzór `src/render/eventRing.js`) — migawka wejścia na krok
  (klawisze lotu, gałki, spust, kursor w świecie), akcje (`GameActions`, mysz, panele, fabuła), wywołania narzędzi.
- Symulacja → wątek gry: strona symulacji po każdym kroku (potrójny bufor `src/render/tripleBuffer.js`, sloty z generacją
  `renderIds.js`) — encje, gracz w całości, bloki HUD (kierowanie ogniem, radar, mgła, cele, UI fabuły, zwiad,
  wydobycie, torpedy); lustra po stronie wątku gry na wzór `RenderMirror`; pierścień zdarzeń — komunikaty, alerty,
  dźwięk, otwarcie stacji, toasty.
- Symulacja → render: strumień rozkazów renderu (`RenderCommands`) pisze już dziś rekordy — pisarz przenosi się z
  symulacją; migawka renderu pakowana w workerze symulacji po kroku albo przepakowywana na wątku gry z luster (prościej
  na start, ~0,3–1 ms — pomiar D7 trybu `inline` z RW-11).
- Zegar: kroki wg akumulatora czasu jak dziś; takt z wątku gry (`Atomics.notify` w każdej klatce rAF — dozwolone na
  wątku gry, `Atomics.wait` w workerze) albo `Atomics.wait` z limitem czasu — bez `setTimeout` (takt 15,6 ms zegara
  Windows). Ziarno losowania w workerze.
- Opóźnienie: rozkaz trafia do najbliższego kroku (+0–16,7 ms przy 60 Hz), wynik widać po publikacji strony — razem
  średnio ~+8 ms względem dziś (gracz i tak jest rysowany z interpolacji między krokami).

Zysk: wątek gry ~1,5–2,5 ms na klatkę bez szczytów — 240 Hz bez chybień z powodu fizyki (model: < 0,5% zamiast 27–34%);
budżet kroku 16,7 ms (dziś efektywnie ~2,5 ms przy 240 Hz) — 3–5× większe bitwy przed spowolnieniem gry albo krok
120 Hz (wierność taranu) w bitwach rozmiaru V1; szczyty kroku nie zatrzymują kamery i UI (zatrzymuje się na chwilę ruch
świata, nie obraz).

Koszt i ryzyko: § 5.2 — rdzeń 378 funkcji / 8,9 tys. linii `index.html` do modułów, 155 odwołań do UI i 26 do wejścia
na zdarzenia i dane kroku, lustra dla ~900 odczytów, rozkazy dla ~110 pisarzy; zmiana kolejności zdarzeń (akcje
w następnym kroku), nowe bazy harnessów (losowanie w workerze), narzędzia przez tryb `page` (jak `?renderWorker=0`)
albo CDP do workera. Praca w jednym pliku słabo się dzieli między sesje.

### B. Sam silnik belek w workerze — nie

§ 5.3: ~100 synchronicznych miejsc, zysk 14–15% kroku, zmiana zachowania broni i taranu. Nie usuwa dwumodalności klatek.

### C. Jądra równoległe na SAB (fork-join z kroku) — nie teraz

Wątek gry nie może `Atomics.wait`, więc łączenie = aktywne czekanie. Nadają się tylko dane w tablicach typowanych:
jądra sąsiedztwa AI (już tanie: 0,16–0,31 ms / krok) i silnik belek (SoA, ale obiekty ciał, kolejność kontaktów,
determinizm). Mózgi i pociski to obiekty JS — bez przepisania na SoA nie do podziału.

### D. Tańszy krok na wątku gry — tak, od razu (szacunki z profilu, do potwierdzenia A/B)

| poprawka | szacunek (ms / krok, V1 → 2 × V1) |
|---|---|
| sąsiedzi AI: unik i przeszkody (`trafficAvoidanceSnapshot`, `selectRanges`, `capitalObstacleSpeedCap`) — K najbliższych / grubsza siatka dla dużych promieni | −0,05 → −0,2 |
| `processAutonomousWeapons` / `buildShipScanCache` — pamięć skanu na takt AI | −0,05 → −0,1 |
| pociski: CIWS × rakiety przez siatkę rakiet zamiast pełnej listy; promienie kolizji i tarcz raz na krok (`stampBulletCollisionRadii`, `entityUsesHullShield`, `ensureShield`, `resolveEntityHullProfileId`) | −0,15 → −0,25 |
| silnik belek: `pairFilter`, `hullSpriteRotation`, `_latticeIndex` (pamięć per ciało) | −0,05 → −0,1 |
| UI z kroku do `loop()` / rzadziej: `InfrastructureUI`, trasy warpa, stan UI stacji, skan pod kursorem | −0,05 → −0,1 |
| liczniki PerfHUD w gorących pętlach (`performance.now` 84 razy w rdzeniu) — próbkowanie | −0,05 |
| razem | ~−0,4…−0,8 (−12…−18%) |

### E. Praca decyzyjna w klatkach bez kroku — tak, przed decyzją o workerze

Dziś wszystko, co jest w kroku, spada w jedną klatkę. Część pracy nie musi być w kroku, bo zapisuje tylko zamiary
(czytane przez całkowanie w następnych krokach): mózgi AI (20 Hz, fazami), skan broni i wybór celów, sąsiedzi,
integralność gniazd (co 3. krok), czujniki i mgła, kierowanie ogniem — razem ~45–55% kroku. Przy 240 Hz są trzy klatki
bez kroku na każdą z krokiem (~2,5 ms wolnego w każdej). Rozłożenie fazy mózgów i reszty pracy decyzyjnej na klatki
bez kroku (z budżetem) skraca klatkę z krokiem o ~30–45%: V1 5,3–5,9 → ~3,5–4 ms (mieści się w 4,17 ms częściej niż
dziś). Granica: suma pracy wątku gry na 1/60 s. V1 w oknie: 4 klatki × ~2 ms + krok 3,9 ms ≈ 12 ms z 16,7 — przy
idealnym rozłożeniu 240 Hz się mieści. U użytkownika: 4 × 3,3 + 6,8 ≈ 20 ms > 16,7 — wątek gry jest przeciążony
dla 240 Hz przy KAŻDYM rozłożeniu (sufit ~180 kl/s, zmierzone ~138); tu pomaga tylko zdjęcie pracy z wątku gry (A)
albo tańsza reszta klatki (audyt renderu). Koszt: zmiana harmonogramu w `loop()` / `npcStep`
(mózgi oddzielone od całkowania lotu), inna kolejność decyzji względem kroku (nowe bazy harnessów); to też krok
w stronę A (mózgi z jawnym wejściem i wyjściem). Zmieniając `loop()`: `rwHost.present()` (stały wiek obrazu,
`src/render/framePacer.js`, audyt renderu) zostaje PIERWSZĄ linią `loop()`, przed fizyką.

### F. Krok 120 Hz — skreślony

§ 4.4.

### G. Interpolacja NPC w obrazie — tak (render)

Do dziś tylko gracz miał pozę z interpolacji (`window.__interpShipPose`), myśliwce na kanwie — `__px / __py`. Kadłuby
NPC, wraki, wieże i mostki szły do migawki w pozie ostatniego kroku 60 Hz; przy 240 Hz każda poza trwa ~4 klatki (przy
zoomie 0,45 i 300 j/s — skok ~2 px co 16,7 ms przy płynnej kamerze). Niezależne od A, a przy A konieczne (strony
symulacji 60 Hz, obraz 240 Hz). W toku w sesji audytu renderu (zgłoszone tam z tego audytu): `src/game/renderPoses.js`
— poza interpolowana między krokami w pakowaniu migawki, ta sama dla wież i maskowania, A/B `?npcLerp=0`.

## 7. Plan, jeśli A (etapy SW, wzorem RW)

Etap 0 — na jednym wątku, każda zmiana ma wartość sama w sobie:

- SW-01 strażnik szwu symulacji (`tests/szewSymulacji.test.mjs` na `scripts/szew-symulacji.mjs`): sufity UI / DOM /
  dźwięku / wejścia / `window` w rdzeniu kroku — liczby mogą tylko spadać.
- SW-02 UI z kroku do `loop()`: stan UI stacji, `InfrastructureUI`, skan pod kursorem, UI skanera i namiaru, CIC,
  HUD nawigacji, cel kamery, kamera gracza 2 (do `render()` z pozą interpolowaną — wtedy P2 dostaje też interpolację
  `renderPoses`).
- SW-03 zdarzenia symulacja → strona: komunikaty (`pushZoneMessage` ×69), toasty, alerty HUD, dźwięk, otwarcie
  stacji — kolejka opróżniana raz na klatkę.
- SW-04 wejście jako dane kroku: migawka wejścia (klawisze lotu, gałki, spust, kursor w świecie) zamiast
  `Input.keyHeld` / `mouse` w kroku.
- SW-05 rozkazy strona → symulacja: `GameActions`, mysz, panele, kokpit, CIC, fabuła — kolejka wykonywana na początku
  kroku.
- SW-06 = wariant E (praca decyzyjna w klatkach bez kroku) + wariant D.
- **Bramka 1**: pomiar w oknie 240 Hz (bitwy V1 i 2 × V1). Jeśli chybienia z powodu fizyki < ~2% w bitwach, które
  gracz robi naprawdę — stop, worker symulacji niepotrzebny.

Etap 1 — wydzielenie rdzenia z `index.html` do modułów `src/sim/` (bez DOM; `window` → fasada albo `globalThis`
w workerze), `physicsStep` z modułu na wątku gry (`?sim=page`). Największy etap; dzieli się po podsystemach (gracz,
broń i pociski, AI i skrzydło, wraki, świat i gospodarka, kolizje, fabuła), ale wszystkie dotykają `index.html`.

Etap 2 — strona symulacji i lustra wątku gry: bloki dla UI i nakładek, nakładki i UI czytają lustra (`?sim=lustra`,
symulacja dalej na wątku gry — sprawdzenie kompletności jak tryb `inline` w RW-11). **Bramka 2**: koszt luster na wątku
gry ≤ ~0,5 ms / klatkę.

Etap 3 — worker symulacji: zegar, ziarno, pierścienie na SAB, migawka renderu, narzędzia (`?simWorker=0` domyślnie dla
harnessu, CDP do workera dla nowych).

Etap 4 — pomiar w oknie 144 / 240 Hz, opóźnienie wejścia, A/B rozgrywki (taran, broń, AI), decyzja o trybie domyślnym.

## 8. Do decyzji użytkownika

- **D1** kierunek: najpierw etap 0 (D + E + interpolacja NPC) i pomiar, czy od razu plan pełnego workera symulacji.
- **D2** krok symulacji w workerze: 60 Hz jak dziś czy 120 Hz (taran wierniejszy — pomiar z 2026-09-24: 400 j/s 95,0% →
  90,7% zniszczenia celu; w workerze CPU fizyki nie zabiera klatek).
- **D3** opóźnienie wejścia przy workerze: do +1 kroku (≤ 16,7 ms przy 60 Hz, ≤ 8,3 ms przy 120 Hz) — do przyjęcia?
- **D4** narzędzia: tryb `page` (symulacja na wątku gry) domyślny dla harnessu jak przy renderze, przenosiny tylko
  kluczowych skryptów.
- **D5** interpolacja NPC (§ 6 G): w toku w sesji audytu renderu — do przyjęcia po jej A/B.

## 9. Pliki

- `scripts/fizyka-kroki.mjs`, `scripts/fizyka-kroki-analiza.mjs`, `scripts/szew-symulacji.mjs` — nowe narzędzia.
- Surowe wyniki (poza gitem): `.tmp/fizyka-worker/` — `wynik-50-20-10-3-z0.45-worker/` (V1), `wynik-100-40-20-6-z0.45-worker/`
  (2 × V1), `wynik-50-20-10-3-z0.45-worker-120/` (V1, 120 Hz), `szew.json`, logi przebiegów; `.tmp/fizyka-kroki/` —
  `50-20-10-3-z0.45-worker-60hz-okno/` i `okno-2/` (okno z vsync 240 Hz), `zamarzanie-sprawdzenie/` (§ 4.6).
- Powiązane: `docs/AUDYT-wydajnosc-bitwa-2026-10-07.md` (§ 8 — workery przed renderem w workerze),
  `docs/AUDYT-wydajnosc-2026-10-11.md`, `docs/AUDYT-przestoje-2026-10-15.md`, `docs/PLAN-render-worker.md`,
  `docs/webgpu/RW-WORKER-STAN.md`, `docs/AUDYT-render-worker-2026-10-17.md` (strona ↔ worker renderu, ten sam dzień:
  poprawka zamarzania obrazu, interpolacja NPC `src/game/renderPoses.js`, stały wiek obrazu `src/render/framePacer.js`,
  prawdziwe kl/s w PerfHUD — w drzewie roboczym, bez commita).

## 10. Etap 0 — wyniki (2026-10-17, ta sama maszyna, tryb renderu `worker`, krok 60 Hz)

Zrobione na jednym wątku (§ 6 E + część § 6 D), bez zmiany rozgrywki poza harmonogramem. A/B bez zmiany kodu:
`?aiPoza=0` albo `window.AiOffStepTune.enabled = false` (wraca cały dawny harmonogram poniżej).

### 10.1 Co się zmieniło

- **Praca decyzyjna AI w klatkach bez kroku** (`index.html`, blok „AI W KLATKACH BEZ KROKU”). Mózgi kubełka NASTĘPNEGO
  kroku (takt 20 Hz, 1/3 okrętów) i utrzymanie taktu (eskadry, kolejka startów z hangarów, skrzydło, układ gniazd,
  odroczone starty, siatka AI, indeks wraków, dowódca floty — `npcAiMaintenance`) liczą się w klatkach bez kroku na
  stanie z końca ostatniego kroku; mózgi piszą tylko zamiary (intencja lotu, cele, wieże, strzały), które całkuje krok.
  Czego klatki nie zdążą — dokańcza krok jak dawniej (`npc.__brainTick`); bez wolnej klatki (monitor 60 Hz) wszystko
  jest jak przed zmianą. Tylko okręty z modelem lotu i myśliwce z pilotem (inne mózgi potrafią całkować ruch same —
  `npcFlight.js`), bez rozkazów RTS, przylotów `warping_in` i hulków mostka. Takt decyzji (`aiDecisionTickId` — klucz
  pamięci separacji i zegar myśliwców) zaczyna się razem z utrzymaniem, przed mózgami kubełka 0. Budżet klatki:
  praca taktu (EMA: część poza krokiem + to, co dokończył krok) rozłożona na wolne klatki do następnego kroku × 1,25,
  w [0,3; 2] ms i nie więcej niż okres klatki × 0,9 minus średnia reszta pracy klatki bez kroku
  (`AiOffStepTune`). Liczniki: `window.__aiOffStep` (`offN` / `inlN` — mózgi poza krokiem / dokończone w kroku, `estMs`),
  PerfHUD — wiersz „Poza krokiem” (ms na klatkę).
- **Warstwa informacyjna** (`stepFrameInfo`: skan pod kursorem, namiary, UI skanera i radaru, fale skanu, drony zwiadu,
  czujniki i mgła wojny, CIC) i **stan UI stacji / infrastruktury** (`stepStationUiState`: terminal, przenikanie panelu,
  edytor, postęp budowy — z sumowanym dt) — w pierwszej klatce bez kroku po krokach; bez takiej klatki — przed
  krokami następnej. **Integralność** (co 3. krok: gniazda, rdzenie, mostki, dysze, zbiorniki, sufity punktów, dym
  zgniotu — `runIntegrityPass`) — tak samo, na liście ciał zbudowanej poza krokiem.
- **Kokpit** (`updatePlayerStatusUI`, z wejściem radaru ~10 Hz) przy monitorze szybszym niż ~110 Hz pomija klatkę
  z krokiem (liczy go następna; dwie klatki z krokiem pod rząd — jak dawniej).
- **Kamera gracza 2** (podzielony ekran) z kroku do `loop()`: z pozy P2 interpolowanej między krokami (`prevState2` —
  zapisywana, a nieużywana), zoom i wstrząs w czasie klatki (`updateCamera2`).
- **CIWS × rakiety przez siatkę** (`RocketThreatGrid`, `src/game/rocketIntercept.js`): kubełki budowane leniwie raz na
  krok, zapytanie zwraca indeksy bufora rosnąco, więc pierwsze trafienie jest bit w bit to samo co przy pełnym
  przeglądzie (złoty test `tests/rocketThreatGrid.test.mjs`, także z rakietami kanwy ruszonymi po budowie siatki); od
  24 rakiet w buforze.
- Narzędzia: `scripts/fizyka-kroki.mjs --query …` (parametry adresu), `--ab N` (A/B W JEDNYM PRZEBIEGU — przełączanie
  `AiOffStepTune.enabled` co N s; fazy bitwy zmieniają się szybciej niż osobne przebiegi, a maszyna dzielona z innymi
  sesjami dryfuje), próbki `aiOff` i `rp` (pozy renderu: `frameDriven` — byty przesunięte bez kroku); analiza — czas
  pracy poza krokiem na klatkę, złożenia workera na sekundę, rozbicie A/B.

Nie zrobione z § 6 D: jądra sąsiedztwa AI, pamięć skanu broni i `processAutonomousWeapons` przestały być w kroku
(liczą się w mózgach poza krokiem), więc ich optymalizacja nie skraca już klatki z krokiem; promienie tarcz
(`getEntityShieldRadiusTowards`, `stampBulletCollisionRadii` ~0,15–0,25 ms / krok) i `pairFilter` silnika belek
(~0,09) — zysk mały, a pamięć „raz na krok” musiałaby uwzględniać śmierć i zmianę kadłuba w środku kroku; liczniki
PerfHUD — bez zmian.

### 10.2 Koszt kroku i klatki (bitwa V1, 166 okrętów, walka)

| | A (dawny harmonogram) | B (etap 0) |
|---|---|---|
| krok, headless, t 35–70 s (osobne przebiegi) | 3,84 ms | 2,26 ms |
| krok, okno 240 Hz, A/B co 3 s | 3,42 (p95 5,78) | 2,20 (p95 4,30) |
| klatka `loop()` z krokiem, okno, p50 / p95 | 5,27 / 9,70 | 3,65 / 7,74 |
| klatka bez kroku, okno, p50 / p95 | 1,68 / 2,89 | 2,12 / 4,14 |
| klatki z krokiem > 4 ms (t ≥ 68 s / 35–50 s) | 53% / 100% | 23% / 32% |
| mózgi policzone poza krokiem (okno / headless) | — | 86–98% / ~55% |

W kroku zostaje: pociski i trafienia 0,6–0,65 ms, silnik belek 0,55–0,7, lot NPC (model lotu, każdy krok) 0,35–0,48,
rakiety 0,19–0,27, kierowanie ogniem gracza 0,1–0,2, rdzenie 0,05–0,1, reszta (gracz, świat, kolizje z pasem,
wraki) ~0,3. W headless klatki trwają 5–7 ms (brak vsync), więc między krokami jest ~1,5 wolnej klatki i krok
dokańcza ~45% mózgów — w oknie 240 Hz tylko 2–14%.

### 10.3 Złożenia workera renderu na sekundę (okno z vsync 240 Hz)

| | A | B |
|---|---|---|
| V1, walka (t ≥ 35 s), wszystkie przedziały | 199 | 205 |
| V1, przedziały, w których worker renderu nadąża (jego takty ≥ 215 / s) | 223 | 222 |
| V1, cięższy przebieg (więcej pocisków) | 171 | 174 |
| 2 × V1, podejście (t 35–60 s) | 220 | 224 |
| 2 × V1, walka (t 63–127 s, pociski 50–420, worker nadąża — ogranicza wątek gry) | 206 | 220 |

Okresy rAF > 1,5 vsynca: V1 t ≥ 68 s 2,8% → 2,7%, t 35–50 s 17,0% → 14,6%; 2 × V1 podejście 2,3% → 1,8%, walka
8,7% → 3,2% (krok 4,44 → 2,41 ms, klatka z krokiem p50 6,64 → 4,55 ms). Pozy renderu: `frameDriven` = 0 przez cały
przebieg — praca poza krokiem nie przesuwa bytów między krokami (interpolacja NPC nietknięta). Przebieg 2 × V1 stanął
w 127 s (0 klatek wątku gry i 0 taktów workera, bez błędów, strona odpowiadała — okno zasłonięte; rAF staje na obu
wątkach), liczby do 127 s. Klatek wątku gry
w tym samym czasie +0,7–8,7%, worker renderu rzadziej czeka na stronę (2 × V1: 36–95 → 4–51 czekań / s).

Cel „≥ ~225 złożeń / s w walce V1” — osiągnięty tam, gdzie worker renderu nadąża (222–238 / s po szczycie walki;
w walce 2 × V1, gdzie ogranicza wątek gry, etap 0 daje +7%: 206 → 220), nie w szczycie (51–66 s V1: 123–160 / s w OBU trybach). W szczycie ogranicza już worker renderu, nie wątek gry:
jego takty rAF spadają do 118–158 / s przy CPU klatki workera 3,4–8 ms (domena sesji „Klatka workera renderu pod
240 Hz”). Druga lekcja: model vsync z § 4.2 (klatka z krokiem > 4,17 ms = chybiony vsync) jest zbyt surowy — Chrome
wchłania pojedyncze długie klatki, gdy średnia praca na 1/60 s mieści się w czterech vsyncach (2 × V1 podejście,
A: 100% klatek z krokiem > 4 ms, a spóźnionych okresów rAF 2,3%). Liczy się suma pracy wątku gry na 1/60 s
(etap 0 jej nie zmniejsza — rozkłada ją; B dokłada ~0,05–0,1 ms narzutu na takt) i nadążanie workera renderu.
Bez fizyki na wątku gry (wariant A z § 6) szczyt i tak stałby na workerze renderu.

### 10.4 Do decyzji (bramka 1, § 7)

Po etapie 0 klatka z krokiem mieści się w budżecie 240 Hz w ~70–77% przypadków (dawniej 0–47%); w bitwach V1 i
2 × V1 gubione obrazy idą dziś z workera renderu w szczycie walki, nie z kroku fizyki. Worker symulacji (§ 6 A) ma
sens dopiero przy bitwach, w których suma pracy wątku gry na 1/60 s przekracza ~16 ms (zrzut użytkownika: krok 6,8 ms
+ 4 × 3,3 ms reszty), albo dla kroku 120 Hz (D2).
