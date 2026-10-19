# Scena „Wojna” i wyjście NPC z warpa z pędem — pomiary (2026-10-19)

Zlecenie (user, 2026-10-19): „przykładowa scena — wojna — dużo statków jak battle over Coruscant: wychodzą z warpa
jednostki i naprzeciwko nich po chwili też wychodzą z warpa jednostki, obydwa się o siebie rozbijają; potrzeba
prędkości wyjścia z warpa i lecenia à la Star Wars, a nie stania pasywnego”. Opis działania: reguły `warp`
(„WYJŚCIE Z PĘDEM”, „SCENA »WOJNA«”) i `flota-ai` („NATARCIE”). Tu liczby.

## 1. Profil wyjścia z pędem (`warpExitMomentum`, k = 3)

Plan (czysta funkcja, model lotu z ogonem pilota τ 0,3 s) — zgodny z `stepShipFlight` ±1,5% (`tests/warpExitMomentum.test.mjs`):

| kadłub | maxSpeed | vExit | ślizg [km] | czas [s] |
|---|---|---|---|---|
| terran_frigate | 1400 | 4200 | 2,82 | 1,06 |
| terran_destroyer | 1000 | 3000 | 2,81 | 1,46 |
| terran_battleship | 650 | 1950 | 2,91 | 2,30 |
| terran_carrier | 480 | 1440 | 2,86 | 3,04 |
| terran_supercapital | 380 | 1140 | 2,62 | 3,51 |
| pirate_frigate | 1500 | 4500 | 3,55 | 1,24 |
| pirate_destroyer | 1080 | 3240 | 3,61 | 1,73 |
| pirate_battleship | 700 | 2100 | 3,94 | 2,87 |
| pirate_supercapital | 380 | 1140 | 2,62 | 3,51 |

Propozycja z pamięci („k = 3 → ~4 km”) liczyła samo `decel`; model lotu ścina nadmiar pilotem (`decel`) i governorem
(0,5 `decel`), więc przy k = 3 ślizg Terra Novy to ~2,8 km. ~4 km dla TN daje k ≈ 3,6 (`DevScene.wojna({ k: 3.6 })`,
`WarpExitTune.k`).

## 2. Ślizgi zmierzone w grze (`node scripts/webgpu/wojna-gra.mjs`, Jowisz, 20 + 25 okrętów, 60 s)

Od zwolnienia z tunelu (koniec hamowania) do prędkości ≤ 1,03 maxSpeed; „błąd punktu” — odległość od punktu przylotu
(końca ślizgu z planu) w tej chwili.

| flota | klasa | n | vExit | ślizg [km] (min / med / max) | czas [s] | błąd punktu [j.] |
|---|---|---|---|---|---|---|
| A | fregata | 9 | 4150 | 2,24 / 2,66 / 2,66 | 0,97 | 198 |
| A | niszczyciel | 5 | 2975 | 2,69 | 1,40 | 75 |
| A | pancernik | 3 | 1940 | 2,81 | 2,20 | 48 |
| A | lotniskowiec | 2 | 1435 | 2,77 / 3,53 | 3,32 | 402 |
| A | superkapitał | 1 | 1136 | 2,37 | 3,20 | 250 |
| B | fregata | 13 | 4455 | 3,38 / 3,38 / 3,41 | 1,17 | 99 |
| B | niszczyciel | 7 | 3209 | 2,57 | 1,27 | 962 |
| B | pancernik | 4 | 2092 | 3,81 | 2,75 | 78 |
| B | superkapitał | 1 | 1136 | 2,55 | 3,37 | 60 |

Wszystkie 45: 2,24–3,81 km, mediana 2,69 km. Pierwsza wersja (bez flagi `__warpExitSlide`) — 4–13 km: mózg w marszu
jechał trybem przelotu / dolotu do szyku (fregaty `travelSpeed` 3200), a superkapitał piratów jako korzeń szyku nie
schodził do prędkości bojowej przez 19 s.

## 3. Przebieg sceny w grze (4. przebieg, ziarno harnessu 0x5eed4242)

- 0–7 s: zwiastuny A, wyjścia falami (9 fregat do 2 s, flagowiec ostatni ~6,9 s); B od 6 s, ostatnie wyjście ~13 s.
- 8–30 s: zbliżanie (odległość środków flot 35 → 9 km), salwy rakiet z 10–15 km (piraci tracą 3 okręty przed
  zwarciem), stoi 0–4 z 45 okrętów (wcześniej, z linią „okręty flagowe z przodu”: do 23 przez ~15 s).
- 30–60 s: zwarcie — 16–32 okrętów w przelotach naraz, myśliwce z lotniskowców (do 15), straty po 60 s: A 9/20,
  B 3/25; w walce stoją głównie lotniskowce (trzymają się za frontem — zgodnie z założeniem).
- Klatki: 3600, przestoje: 5 (maks. 72 ms CPU — przyczyn ten przebieg nie rozbijał; harness zapisuje dziś listę
  `klatki.lista`), **pipeline'y synchroniczne: 0** (10 asynchronicznych — ring Jowisza w tle), błędy konsoli: 0. `Core3D.gpuFrameMs` 0,5–1,5 ms (headless, 1600 × 900).
- Kadr: reżyser kadru przy przylotach oddala do ~45 km (zoom 0,035), w zwarciu przybliża do ~0,042.

Zrzuty: `.tmp/wojna/gra4/*.png` (zwiastuny 1,5 s, przylot A 4 s, przylot B 9–13 s, zbliżanie 16–26 s, zwarcie 35 s,
po 50 s), wyniki: `.tmp/wojna/gra4/wyniki.json`.

## 4. Natarcie w symulacji (`node scripts/szyk-floty.mjs --seeds 1-6`)

Fazy 1–5 (zbiórka, przelot, zakręt, ESKORTA, ATAK) bit w bit jak przed zmianami (zetknięcia, lot bokiem, postój burtą
— 6 ziaren). Faza NATARCIE (skrzydło 60 okrętów kontra świeży klin 26 piratów 25 km naprzeciw, obie strony 'charge'):

| wariant | zetknięcia (śr.) | z wrogiem | lot bokiem | w przelocie < 0,6 v | stoi z celem | przeloty / okręt / min |
|---|---|---|---|---|---|---|
| linia + turnStep 0,75 | 2,2 | 2,5 | 2,0% | 20,2% | 6,2% | 2,4 |
| linia + turnStep 0,55 | 1,5 | 1,5 | 1,3% | 19,8% | 6,5% | 2,4 |
| szyk „jak przyleciał” + 0,55 (wdrożony) | 1,5 | 2,0 | 1,1% | 18,0% | 5,8% | 2,2 |

Wolne przeloty to głównie fregaty w tłumie 50 własnych fregat: objazd okrętu na kursie (`approachCap` 0) — w scenie
(9–13 fregat na stronę) 3–16 z 16–40 okrętów w przelotach.

## 5. Tunelowanie przy prędkości wyjścia (`node scripts/tunelowanie-sym.mjs --tryb kadluby --v 4200,6400,8700`)

Rastry kadłubów z gry, 12 faz na konfigurację. Czołowo i burtą — 0% przelotów bez styku dla wszystkich par
(Atlas × pancernik / superkapitał piratów, fregata × fregata, niszczyciel × fregata, niszczyciel × niszczyciel);
głębokość przed pierwszym stykiem przy 8700 j/s (dwie fregaty czołowo, 60 Hz): śr. 4,6, maks. 9,1 komórki (120 Hz:
2,2 / 4,4). Przelatują tylko MUŚNIĘCIA niszczyciel × niszczyciel z zakładem ≤ 1 komórki: 60 Hz — 8–25% przy 4200,
42–50% przy 6400, 58–67% przy 8700 (120 Hz: 0 / 0 / 8–25%) — ten sam znany przypadek co przy 6000 j/s (reguła
`kadluby-belki`, „TUNELOWANIE”). Czołówka dwóch okrętów w pełnym ślizgu (4200 + 4500) wymaga przylotów naprzeciw
siebie w odległości ślizgu — scena stawia floty 25 km od siebie.

## 6. Bitwa w głębi — druga wersja sceny (2026-10-19)

User po pierwszej wersji (floty nad tarczą Jowisza): „kompletnie minąłem się z celem — bitwa o Coruscant to masa
statków na wielu płaszczyznach; planeta znacznie niżej niż płaszczyzna gry; statki poza zasięgiem gracza duże blisko
kamery (inny Atlas wali serię w battleshipa i go niszczy), wylot z warpa Atlasa i supercapitala piratów, którzy niszczą
się obaj; masa statków w oddali i w przybliżeniu; kinematografia”. Opis działania: reguła `scena-wojna`. Tu liczby.

**Symulacja widoku (Node, `createWarBackdropSim`, gęstość 1, 60 s po rozbiegu 20 s, 3 przebiegi):** ~700–710 żywych
okrętów (sufit 1024), 560 myśliwców, ~10 zniszczeń / s (zastępstwa z warpa), ~1 wielki laser / s w całym tłumie;
zdarzenia obrazu PRZED odcinaniem kadru: ~390 smug / s, ~240 błysków / s, ~190 odłamków / s, ~9 smug przylotu / s.
Krok: średnio ~0,1 ms na klatkę 60 Hz, najdłuższy 0,5–1,3 ms; rozbieg 18–20 s — 120–200 ms CPU (w grze porcjami
≤ 6 ms na klatkę, obraz schowany do końca rozbiegu). To samo ziarno → identyczny przebieg (test).

**Błąd znaleziony w grze — wiązki i smugi niewidoczne (pułapka TSL 39):** pierwszy przebieg pokazał błyski
z pierścienia zdarzeń, ale ani jednej wiązki ani smugi. Sonda (zdarzenia wstrzyknięte pod kamerą) i zrzut WGSL z Node:
zagnieżdżone `select` w `positionNode` zbudowały się jako if / else, a szerokość kwadu i `modelViewMatrix` (wspólne dla
gałęzi billboardu i kwadu kierunkowego) przypisały się tylko w gałęzi billboardu — kwady kierunkowe miały szerokość 0.
Naprawa: `Fn` z jawnymi zmiennymi przed rozgałęzieniem, rodzaj — maski 0 / 1 (`step`), varyingi `varyingProperty`.

**Planeta (sonda z wymuszonym kierunkiem światła, tłum schowany):** oświetlenie zgodne z kierunkiem Słońca (z góry
kadru: dzień u góry, noc z siecią świateł tras u dołu, pas zmierzchu w poprzek). Wrażenie „cała tarcza oświetlona”
robiły chmury Wenus oświetlone przy terminatorze i łuna zmierzchu — chmury gasną teraz z terminatorem i barwią się
zmierzchem. Próba „ekumenopolis” (dywan świateł miasta z gładkiego szumu gry po stronie nocnej) dała w kadrze beżowe
plamy jak dym, nie światła — wycofana; noc pokazuje sieć tras z mapy nocnej Wenus (`uCity` 1,6). Świateł miasta
w skali Coruscant trzeba by szukać w mapie (generator planet), nie w szumie.

**Przebiegi w grze (`node scripts/webgpu/wojna-gra.mjs`, tryb off, 1600 × 900, 60 s):** pipeline'y synchroniczne 0,
błędy strony 0; w kadrze tła 420–780 kadłubów (pasma pod płaszczyzną), FG 3–46, poświat 590–860; ujęcia kamery
o czasie (szeroki kadr od 0,25 s — zoom ograniczony `camera.minZoom` 0,035, kadr kombo 9,6–12,7 tys. j. wysokości,
pojedynku 10,5–13,4 tys.). Przestoje na starcie sceny: klatka startu (plan, teleport, floty, rozbieg w jednej klatce —
zegar harnessu stoi, więc budżet porcji rozbiegu nie działa) i klatka wgrania tekstur (atlas 4096 × 2144 i mapy planety
naraz: 42,6 MB, ~65 ms CPU) — tekstury idą teraz kolejką po jednej na klatkę.
