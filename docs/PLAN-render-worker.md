# Render w workerze — szew gra ↔ 3D, migawka klatki, rozkazy, kanał zwrotny (plan, 2026-10-07)

> Zadanie z sesji „Rendering w workerze” (2026-10-07): rozpisać szew między grą a warstwą 3D, zaprojektować migawkę
> klatki, rozkazy i kanał zwrotny pod render w Web Workerze (OffscreenCanvas + WebGPU) i pociąć pracę na niekolidujące
> zadania. **Bez zmian w kodzie gry.** O przenosinach użytkownik zdecyduje po prototypie (RW-02) i tym planie.
> Stan kodu: `main` 00afd9d + drzewo robocze z 2026-10-07 ~23:00 (równolegle pracowały sesje: tanie poprawki renderu
> w bitwie, odrost węzłów kadłuba, misja 2 — `index.html` przesuwał się w trakcie inwentarza o kilka linii). Numery
> linii `index.html` (29 765 linii) są z tej chwili — przy pracy szukaj po nazwach funkcji. Liczby inwentarza liczą
> skrypty `.tmp/render-szew/*.mjs` (§ 6), opisy modułów pochodzą z czytania kodu.

## 0. W skrócie

- **Zysk.** Bez warstwy 3D na wątku głównym klatka bitwy 166 okrętów spada z ~27 do ~5 ms (zoom 0,1) i z ~18 do
  ~8 ms (0,45). Fizyka 120 Hz zabiera stały kawałek sekundy, więc fps = (1000 − 120·S) / D — każda milisekunda zdjęta
  z D działa podwójnie. Realny worker ogranicza własny koszt (~10–13 ms przy zoomie 0,1): szacunek **~2× fps**.
  Migawka (encje, pociski, 36–45 tys. węzłów) kosztowała wątek główny 0,3–0,7 ms (§ 1).
- **Szew to granica, nie shadery.** `index.html` odwołuje się do warstwy renderu 350 razy (87 symboli w 270
  odwołaniach + 6 uchwytów fabryk w 80 — `haloRings`, `asteroidBelt`, `mainScene3D`…): 59 to aktualizacja klatki, 65
  zdarzenia z gry, 134 konfiguracja i rozgrzewka, 68 zapytania zwrotne, 24 czyste dane wspólne. Symulacja importuje
  render 29 razy (15 modułów; 11 celów to czyste układy, 4 stanowe), render importuje symulację 105 razy (52 → 39
  modułów: 24 czyste, 4 zegary i kontenery klatki, 3 stan rozgrywki, **7 to rozgrywka tworzona lub krokowana przez
  moduły 3D**, 1 szyna). 43 zmienne gry z `window.*` (164 odczyty; 33 zmienne / 134 odczyty w modułach do workera).
  3 odczyty GPU, od których zależy rozgrywka. 56 z 92 skryptów harnessu czyta `Core3D` w stronie.
- **Najtrudniejsza jest rozgrywka w modułach 3D**, nie przenoszenie: rakiety (cały lot i trafienia w
  `src/effects3d`, krok w klatce rAF), pas asteroid (wydobycie powstaje po odczycie banku skał z GPU, kolizje
  z olbrzymami istnieją tylko, gdy kadr dotknie pasa), ring (kolider, teren z mapy GPU, automat stanowisk K-7 krokowany
  w renderze i zależny od widoczności), suchy dok (stan kawałków i `_dockGone` buduje render, wynik break / ram steruje
  grą), warp „Nurt” (zegar efektu decyduje o spawnie wsparcia, efekt pisze pozę i `isCollidable` okrętów), tarcze
  (przebicia z GPU co 0,1 s — i tylko dla tarcz na ekranie), maskowanie i wieżyczki (stan liczony w renderze czyta
  kanwa 2D), zimne wraki, wstrząs kamery (§ 2.6).
- **Projekt (§ 3):** migawka klatki w `SharedArrayBuffer` z bloków o stałym układzie (wzór: pył hal K-7), potrójny bufor
  na `Atomics.exchange` (ten w `src/physics/sharedBuffers.js` nie chroni strony czytanej), sloty slot + generacja dla
  encji, ciał, pocisków i zasobów, lustra encji w workerze (moduły 3D czytają te same pola co dziś), węzły belek
  w układzie ciała (okręt w locie zmienia tylko pozę), pierścień rozkazów SPSC z rekordami zmiennej długości
  i numerem klatki (~70–170 rekordów na klatkę), kanał zwrotny (SAB + `postMessage`), czasy bezwzględne zamiast
  przyrostów, żadnego synchronicznego zapytania gry do renderu.
- **Kompozycja (§ 3.8):** A — kanwa workera w DOM pod kanwą 2D: zero kopii, ale nakładki przyklejone do świata rozjadą
  się z 3D przy ruchu kamery (wieżyczki 2D i myśliwce trzeba przenieść do workera); B2 — bitmapa z workera składana
  z nakładkami tej samej klatki: para dokładna, +1 klatka opóźnienia, nakładki bez przenoszenia. Rozstrzyga prototyp
  RW-02 (7 kryteriów).
- **Plan (§ 4):** 6 etapów, 30 zadań (RW-01…RW-52; RW-11 w trzech podzadaniach) z plikami, kryterium, zależnościami i kolizjami. Etapy 0–3 działają
  na jednym wątku i dają korzyść bez workera: strażnik zatrzymuje rozrost szwu, wizualia deterministyczne niezależnie
  od kanwy 2D (dwa strumienie `fxRandom`), rozgrywka pasa, ringu, doku i warpa testowalna w Node i niezależna od kamery
  i GPU, opcjonalnie rakiety niezależne od fps. Decyzje D1–D8 — § 5.

## 1. Pomiar i model zysku

Pomiar sesji „Rendering w workerze” (`.tmp/worker-ab.mjs`, logi `.tmp/worker-ab-teraz-z01.log`, `-z045.log`,
`-v1-*.log`; 2026-10-07): bitwa 166 okrętów (`--sklad 50,20,10,3` na stronę, jak `scripts/profil-bitwy-flot.mjs`),
w JEDNEJ bitwie fazy po 4 s na zmianę — N (normalnie), R (bez `Core3D.renderSingle` i kopii kanwy), A (bez całej
warstwy 3D: aktualizacje modułów 3D i render; wtyczka Vite wstawia strażniki `globalThis.__bez3D` w wejścia 3D, pliki
gry nietknięte). Fazy walki (cykle N / R / A z tego samego momentu bitwy):

| zoom | t [s] | klatka N [ms] | klatka R [ms] | klatka A [ms] | fps N / A | fizyka [ms/krok] |
|---|---|---|---|---|---|---|
| 0,1 | 34–42 | 23,0 | 16,5 | 6,2 | 43 / 162 | 2,7–3,2 |
| 0,1 | 46–54 | 33,9 | 23,7 | 8,1 | 30 / 124 | 3,9–4,3 |
| 0,1 | 58–66 | 28,0 | 17,3 | 5,0 | 36 / 200 | 3,6–3,8 |
| 0,1 | 70–78 | 21,7 | 12,1 | 2,3 | 46 / 442 | 2,8–3,0 |
| 0,45 | 46–54 | 15,7 | 11,5 | 3,8 | 64 / 262 | 3,0–3,4 |
| 0,45 | 58–66 | 15,1 | 6,6 | 8,7 | 66 / 115 | 2,5–3,7 |
| 0,45 | 70–78 | 24,3 | 17,3 | 11,3 | 41 / 89 | 3,5–4,1 |

Średnio w walce: zoom 0,1 — klatka ~27 → ~5 ms, zoom 0,45 — ~18 → ~8 ms. Rysowanie N przy zoomie 0,1: 10–15 ms
na klatkę (aktualizacje 3D 5–7 ms, z tego `updateHexShips3D` 4,7–6,7 ms; render Core3D 3,9–5,5 ms; kanwa 2D 0,3–0,5 ms).
Fizyka na krok jest w trzech fazach taka sama — zysk nie pochodzi z szybszej fizyki.

**Mechanizm.** Fizyka kroczy stałym krokiem 120 Hz, więc co sekundę zabiera wątkowi głównemu 120·S ms (S = koszt
kroku, w walce 2,7–4,3 ms → 330–520 ms na sekundę). Reszta sekundy dzieli się na klatki o koszcie D (wszystko poza
fizyką): **fps = (1000 − 120·S) / D**. Przy S = 3,5 ms zostaje ~580 ms na sekundę: D = 11 ms daje ~53 fps, D = 2,5 ms
— ~230 fps. Każda milisekunda zdjęta z D przy dużym S działa podwójnie, bo mniej klatek „dzieli” tę samą resztę.

**Szacunek workera.** Realny worker = faza A + migawka na wątku głównym + własny koszt workera. Migawka
(zmierzona w tym samym przebiegu co 8. klatkę, `--snap 1`): encje (~24 pola) i pociski (~12 pól) 0,08–0,32 ms,
węzły belek (x, y aktywnych węzłów) 0,18–0,58 ms (maks. 2,25 ms) — przy 166–173 encjach, do 144 pociskach i
36–45 tys. węzłów. Worker = aktualizacje 3D + render Core3D + lustra ≈ 10–13 ms na klatkę przy zoomie 0,1 → sufit
~77–100 fps, gdy wątek główny bez 3D robi ~120–200 fps. Wynik: **~2× fps** w obu zoomach (przy 0,45 worker ~6–8 ms).
Worker staje się wąskim gardłem — dalsze przyspieszenia to koszt aktualizacji 3D w workerze (praca sesji renderu CPU
zostaje w pełni przydatna). Ten dokument aktualizuje § 8 p. 4 `docs/AUDYT-wydajnosc-bitwa-2026-10-07.md` („renderu nie
przenosić”) — tamta ocena powstała przed pomiarem.

## 2. Inwentarz szwu

Warstwa renderu = `src/3d`, `src/vfx`, `src/effects3d` (z `src/3d/planet3d.assets.js`); symulacja = `src/game`, `src/ai`.
Pliki ładowane przez grę liczone grafem importów od `index.html` (statyczne, dynamiczne `import()`, workery) — 481
plików, w tym 244 moduły renderu (106 625 linii) i 159 modułów symulacji; dema i narzędzia nie wchodzą.

### 2.1 `index.html` → warstwa renderu

Główny skrypt modułowy (`index.html:840–29730`) importuje z renderu 37 deklaracjami 68 nazw (z `three` włącznie),
a do tego używa globali, które moduły renderu wystawiają na `window` (`initPlanets3D`, `updatePlanets3D`, `setSkyZone`,
`window.rocketSystem3D`, `window.makeReactorBlow`, `HullLighting`…; most `window.Core3D`, `initStations3D`,
`updateStations3D`, `Destruction3D` w małym skrypcie `index.html:776–836`) i uchwytów — zmiennych przypisanych
z fabryk renderu (`haloRings ← new HaloRingGame`, `asteroidBelt ← createAsteroidBelt`, `reactorBlastFx`,
`reactorModel3D`, `mainScene3D`, `planetScene3D`).

**Liczby:** 87 symboli w 270 odwołaniach (import 193, `window.X` 50, globalne 27) + 6 uchwytów w 80 odwołaniach — razem
93 / 350. Grupy (reguła: rodzaj użycia z AST + osiągalność jednostki skryptu od `render()` i `physicsStep()` w grafie
1953 jednostek najwyższego poziomu + jawne wyjątki dla funkcji wołanych przez `window.*`, np. `window.fireWeaponCore`):

| grupa | wszystkie | bez uchwytów | uchwyty | co to jest |
|---|---|---|---|---|
| aktualizacja klatki | 59 | 43 | 16 | wywołania z `render()` / `loop()` i funkcji osiągalnych tylko z nich |
| zdarzenia z gry | 65 | 60 | 5 | wywołania z fizyki, broni, obrażeń, rozkazów UI i fabuły tworzące efekt albo zmieniające scenę |
| konfiguracja i rozgrzewka | 134 | 108 | 26 | start, ekran ładowania, opcje, wstrzykiwanie haków (`HullBodies.onImpact = HullDamageMap.onHullImpact`, `setEntityHiddenTest`, `Turret2D.skipDraw`, `CollisionFX.on`…), wystawienie na `window` |
| zapytania zwrotne | 68 | 35 | 33 | wynik wraca do gry lub UI: `isShieldBreachedAt`, `asteroidBelt.pointBlocked / field / rig / giants`, `haloRings.constrainShip / pointInSlab / entries`, `WarpNurt.time / arrivals`, `pirateDryDockBrokenChunks`, `breakPirateDryDockChunk`, `isColdFreezeVisuallySafe`, `rocketSystem3D.rockets`, `WeaponFx.available`, `__weapon3dCameraShake`, statystyki |
| czyste dane wspólne | 24 | 24 | 0 | `computeHaloRingLayout`, `resolveRingPlanetWorldRadius`, `SHIP3D_MODELS`, `WEAPON3D_FAMILY`, `stampFamilyFor`, `dryDockChunkAt / NearestChunk`, `fxRandom` — bez szwu (obie strony importują to samo; `fxRandom` do rozdzielenia, RW-20) |

Symbole (n = liczba odwołań; w kolumnach numery linii `index.html`; ostatnia kolumna — strona po podziale):

| symbol | moduł | n | klatka | zdarzenie | konfiguracja | zapytanie | wspólne | po podziale |
|---|---|---|---|---|---|---|---|---|
| `haloRings` | uchwyt ← `HaloRingGame` | 29 | 5582, 26133, 26134, 26182, 26186, 28368 |  | 2430, 2432, 10736, 10737, 28441 | 5582, 10780, 10799, 10800, 10801, 21848, 24865, 24867, 24874, 24879, 24910, 26182, 26186, 28357, 28446, 28449 |  | rozciąć (kolider, automat K-7 → gra) |
| `WeaponFx` | `3d/weapons/weaponFx.js` | 27 |  | 10262, 10263, 10314, 10316, 11130, 11132, 11133, 11165, 19899, 19901, 20437, 20482, 20501, 20553, 20630 | 1471, 1496, 1504, 1505, 6448, 10535, 10537 | 10260, 10522, 11127, 11161, 21274 |  | worker |
| `Core3D` | `3d/core3d.js` (most `window`) | 25 | 26083, 26088, 26323 |  | 1468, 1471, 1473, 1475, 1483, 1484, 1485, 1496, 1498, 1505, 1508, 1509, 1515, 2413, 10733, 28655, 28689, 28693, 28717, 28732 | 10733, 28606 |  | worker |
| `asteroidBelt` | uchwyt ← `createAsteroidBelt` | 22 | 5583, 26171, 26173, 26189 |  | 10947, 10949, 10950, 28713, 28715, 28717 | 8465, 21836, 24246, 24271, 26189, 28461, 28462 |  | rozciąć (wydobycie, olbrzymy, pole → gra) |
| `CanvasVFX` | `vfx/canvasParticleSystem.js` | 18 | 25153, 26436, 26755, 26766, 26769, 26859 | 20989, 20991, 20993, 21190, 21296, 21299, 21306, 21310 | 10970, 10971, 10972, 10973 |  |  | gra (kanwa 2D) |
| `fxRandom` | `3d/fx/fxRandom.js` | 13 |  |  |  |  | 2197, 19457, 19458, 19543, 19548, 19549, 21300, 21301, 21306 | oba (rozdzielić strumienie) |
| `invalidateHexShipEntity3D` | `3d/hexShips3D.js` | 12 |  | 6695, 20872, 20873, 20879, 20880, 22978, 27968, 29274 | 6695 |  |  | worker |
| `mainScene3D` | uchwyt ← `initWorld3D/initPlanets3D (pośrednio)` | 11 |  | 14724, 14726, 28064, 28066 | 10919, 10922, 10925 | 14722, 14724, 28062, 28064 |  | worker |
| `WarpNurt` | `3d/warp/warpNurt.js` | 10 | 26118 | 1930, 8532, 8574, 8581, 8688 | 1490, 25912 | 8570, 28500 |  | rozciąć (harmonogram przylotów → gra) |
| `rocketSystem3D` | `effects3d/rocketSystem3D.js` | 10 | 25198 | 9860 | 9889, 10114 | 5567, 10111, 19922, 19932, 20086 |  | rozciąć (lot i trafienia → gra) |
| `reactorBlastFx` | uchwyt ← `createReactorBlastFx` | 8 | 26288, 26297, 26298, 26299 | 21011 | 1505, 1506 |  |  | worker |
| `HullDamageMap` | `3d/hullDamageMap.js` | 6 |  | 9458, 9462, 11121 | 940, 941, 942 |  |  | worker (haki → rozkazy) |
| `planetScene3D` | uchwyt ← `initWorld3D/initPlanets3D (pośrednio)` | 6 |  |  | 2611, 2613, 10911, 10930, 10958, 10959 |  |  | worker |
| `initWorld3D` | `3d/world3d.js` | 6 |  |  | 10915 | 10916, 14722, 14723, 28062, 28063 |  | worker |
| `HullLighting` | `3d/hullLighting.js` | 6 |  |  | 29640, 29651, 29660 | 29640 |  | worker |
| `HallDust` | `3d/gasField/hallDust.js` | 5 | 26178, 26188 |  | 1079, 1487 |  |  | worker |
| `makeReactorBlow` | `3d/explosions/explosionFx.js` (fabryka → `window`) | 5 |  | 6333, 28133 | 1496, 1499, 28503 |  |  | worker |
| `CollisionFX` | `vfx/collisionFx.js` | 5 |  | 28229 | 6060, 6061, 28175, 28176 |  |  | gra (szyna zderzeń) |
| `Destruction3D` | `vfx/destruction3D.js` (most `window`) | 4 | 26195 | 21146 | 1497 |  |  | worker |
| `reactorModel3D` | uchwyt ← `createReactor3D` | 4 | 26300, 26302 |  | 1507, 1517 |  |  | worker |
| `initStations3D` | `3d/stations3D.js` (most `window`) | 4 |  |  | 2600, 2603, 10928, 10929 |  |  | worker |
| `attachPirateStation3D` | `3d/world3d.js` | 4 |  | 14721, 14726, 28061, 28066 |  |  |  | worker |
| `isShieldBreachedAt` | `3d/shield3D.js` | 3 |  |  | 1062 | 9643, 21613 |  | kanał zwrotny |
| `BridgeFx3D` | `3d/bridgeFx3D.js` | 3 | 26266 |  | 1471, 1477 |  |  | worker |
| `Bridge3D` | `3d/bridge3D.js` | 3 | 26265 |  | 1473, 1477 |  |  | worker |
| `Dev` | `3d/planet3d.assets.js` | 3 |  | 2656 | 7382 |  |  | worker |
| `Turret2D` | `vfx/turret2D.js` | 3 | 26271, 26747 |  | 6446 |  |  | gra (kanwa 2D) + rekordy dla 3D |
| `computeHaloRingLayout` | `3d/haloRing/haloRingLayout.js` | 3 |  |  |  |  | 6902, 7030, 10755 | wspólne |
| `pirateDryDockBrokenChunks` | `3d/pirateDryDockGame.js` | 3 |  |  | 28485 | 28118, 28271 |  | stan → gra |
| `SparkSystem3D` | `3d/sparkSystem3D.js` | 2 |  |  | 1178, 1483 |  |  | worker |
| `initHexShips3D` | `3d/hexShips3D.js` | 2 |  |  | 1465, 1466 |  |  | worker |
| `SpaceDust3D` | `3d/dust/spaceDust3D.js` | 2 | 26124 |  | 1523 |  |  | worker |
| `detachPlanetStations3D` | `3d/stations3D.js` (most `window`) | 2 |  |  | 2610, 2611 |  |  | worker |
| `shipModel3DIdFor` | `3d/ships3d/shipModels3DGame.js` | 2 |  |  |  | 5043, 6441 |  | worker |
| `resizeHexShips3D` | `3d/hexShips3D.js` | 2 |  |  | 6301 |  |  | worker |
| `SHIP3D_MODELS` | `3d/ships3d/ships/ships3D.js` | 2 |  |  |  |  | 6417, 6419 | wspólne |
| `turretMuzzleZ` | `3d/ships3d/shipModels3DGame.js` | 2 |  |  | 6448 | 6459 |  | worker |
| `__setStation3DScale` | `3d/world3d.js` | 2 |  |  | 7380, 7383 |  |  | worker |
| `resolveRingPlanetWorldRadius` | `3d/ringScale.js` | 2 |  |  |  |  | 15223, 25666 | wspólne |
| `destroyStation3D` | `3d/stations3D.js` | 2 |  | 21155, 21156 |  |  |  | worker |
| `isColdFreezeVisuallySafe` | `3d/hexShips3D.js` | 2 |  |  |  | 22967 |  | kanał zwrotny / gra |
| `captureColdWreckImpostor` | `3d/hexShips3D.js` | 2 |  | 22977 |  |  |  | worker |
| `worldToScreen` | `3d/planet3d.assets.js` | 2 | 25214 |  | 25286 |  |  | worker |
| `setSkyZone` | `3d/planet3d.assets.js` | 2 | 26120 |  |  |  |  | worker |
| `updatePlanets3D` | `3d/planet3d.assets.js` | 2 | 26121 |  |  |  |  | worker |
| `updateStations3D` | `3d/stations3D.js` (most `window`) | 2 | 26149 |  |  |  |  | worker |
| `updateWorld3D` | `3d/world3d.js` | 2 | 26156 |  |  |  |  | worker |
| `updateHexShips3D` | `3d/hexShips3D.js` | 2 | 26213, 26269 |  |  |  |  | worker |
| `drawHexShips3D` | `3d/hexShips3D.js` | 2 | 26324, 26325 |  |  |  |  | worker |
| `breakPirateDryDockChunk` | `3d/pirateDryDockGame.js` | 2 |  |  |  | 28129, 28158 |  | stan → gra |
| `ramPirateDryDockChunk` | `3d/pirateDryDockGame.js` | 2 |  |  |  | 28213, 28279 |  | stan → gra |
| `prewarmHexShips3D` | `3d/hexShips3D.js` | 2 |  |  | 28688, 28689 |  |  | worker |
| `Core3DShaftQuality` | `3d/core3d.js` (most `window`) | 2 |  |  | 29586 |  |  | worker |
| `Core3DLacquer` | `3d/hullLacquer.js` (most `window`) | 2 |  |  | 29618 |  |  | worker |
| `SHIELD_TUNING` | `3d/shield3D.js` | 1 |  |  | 1057 |  |  | worker |
| `getShieldPoolStats` | `3d/shield3D.js` | 1 |  |  | 1060 |  |  | worker |
| `probeShieldSlot` | `3d/shield3D.js` | 1 |  |  | 1061 |  |  | worker |
| `HALL_DUST_TUNE` | `3d/gasField/hallDust.js` | 1 |  |  | 1080 |  |  | worker |
| `K7_FUEL_TUNE` | `3d/haloRing/haloPortK7Fuel.js` | 1 |  |  | 1087 |  |  | worker |
| `createRocketFx` | `3d/rockets/rocketFx.js` | 1 |  |  | 1484 |  |  | worker |
| `initRocketSystem3D` | `effects3d/rocketSystem3D.js` | 1 |  |  | 1485 |  |  | worker |
| `createExplosionFactory` | `3d/explosions/explosionFx.js` | 1 |  |  | 1496 |  |  | worker |
| `createReactorBlastFx` | `3d/reactorBlast/reactorBlastFx.js` | 1 |  |  | 1505 |  |  | worker |
| `createReactor3D` | `3d/reactor3D.js` | 1 |  |  | 1507 |  |  | worker |
| `MenuBackdrop3D` | `3d/menuBackdrop3D.js` | 1 |  |  | 2432 |  |  | worker |
| `configureShipModels3D` | `3d/ships3d/shipModels3DGame.js` | 1 |  |  | 6426 |  |  | worker |
| `setBeamSkinSuppressor` | `3d/hexShips3D.js` | 1 |  |  | 6441 |  |  | worker |
| `setEntityHiddenTest` | `3d/hexShips3D.js` | 1 |  |  | 6443 |  |  | worker |
| `setWorld3DHiddenTest` | `3d/world3d.js` | 1 |  |  | 6444 |  |  | worker |
| `setPirateDryDockHiddenTest` | `3d/pirateDryDockGame.js` | 1 |  |  | 6445 |  |  | worker |
| `WEAPON3D_FAMILY` | `3d/ships3d/weapons/weapons3D.js` | 1 |  |  |  |  | 6446 | wspólne |
| `setShipModels3DWarmIds` | `3d/ships3d/shipModels3DGame.js` | 1 |  |  | 6466 |  |  | worker |
| `HaloRingGame` | `3d/haloRing/haloRingGame.js` | 1 |  |  | 10736 |  |  | worker |
| `initPlanets3D` | `3d/planet3d.assets.js` | 1 |  |  |  | 10905 |  | worker |
| `createAsteroidBelt` | `3d/asteroids/asteroidBelt.js` | 1 |  |  | 10949 |  |  | worker |
| `stampFamilyFor` | `3d/hullDamageStamps.js` | 1 |  |  |  |  | 11121 | wspólne |
| `__rocketFx` | `3d/rockets/rocketFx.js` | 1 |  | 21427 |  |  |  | worker |
| `drawFighterSprite` | `vfx/fighterSprite.js` | 1 |  |  |  | 25832 |  | gra (kanwa 2D) |
| `prewarmHexShipVisual` | `3d/hexShips3D.js` | 1 | 25865 |  |  |  |  | worker |
| `__weapon3dCameraShake` | `3d/weapons/weaponFx.js` | 1 | 26047 |  |  |  |  | worker |
| `setShipModels3DView` | `3d/ships3d/shipModels3DGame.js` | 1 | 26095 |  |  |  |  | worker |
| `updatePirateDryDock3D` | `3d/pirateDryDockGame.js` | 1 | 26159 |  |  |  |  | worker |
| `syncWorldBodies3D` | `3d/worldBodies3D.js` | 1 | 26161 |  |  |  |  | worker |
| `syncShipModels3D` | `3d/ships3d/shipModels3DGame.js` | 1 | 26271 |  |  |  |  | worker |
| `updateShields3D` | `3d/shield3D.js` | 1 | 26281 |  |  |  |  | worker |
| `__hexShips3DLastDrawPerf` | `3d/hexShips3D.js` | 1 | 26327 |  |  |  |  | worker |
| `attachPirateDryDock3D` | `3d/pirateDryDockGame.js` | 1 |  | 28104 |  |  |  | worker |
| `attachPirateDryDockBodies` | `3d/pirateDryDockGame.js` | 1 |  | 28106 |  |  |  | worker |
| `dryDockChunkAt` | `3d/portBuildings/pirateDryDockLayout.js` | 1 |  |  |  |  | 28119 | wspólne |
| `dryDockNearestChunk` | `3d/portBuildings/pirateDryDockLayout.js` | 1 |  |  |  |  | 28120 | wspólne |
| `prewarmShields3D` | `3d/shield3D.js` | 1 |  |  | 28693 |  |  | worker |
| `HullSurface` | `3d/hullSurface.js` | 1 |  |  | 28701 |  |  | worker |
| `prepareStations3D` | `3d/stations3D.js` | 1 |  |  | 28709 |  |  | worker |

Uwagi: `CanvasVFX` (18), `Turret2D.draw`, `drawFighterSprite` i `CollisionFX` (szyna zderzeń, którą słucha też
rozgrywka: zerwanie maskowania, taran doku) zostają na wątku głównym — to kanwa 2D i logika. `WeaponFx` ma 27 odwołań,
z czego 15 to zdarzenia z fizyki (PD, flak, przebicia, ładowanie, trafienia) i 5 zapytań `available`.

### 2.2 Importy symulacja ↔ render

**Symulacja → render: 29 importów z 15 modułów `src/game` do 15 modułów renderu.** 11 celów to czyste moduły bez
three (układy ringu, K-7, zatok, doku, pyłu hal, stempli kraterów) — mogą zostać wspólne albo przejść do neutralnego
katalogu. 4 cele niosą STAN: `collisionFx.js` (szyna zderzeń używana przez rozgrywkę), `fxRandom.js` (wspólny generator
— RW-20), `weaponFx.js` (Hexlance w `superweapon.js` woła efekty wprost), `turret2D.js` (`weaponController.js` —
tylko czysta geometria `writeMuzzleOffset`).

| moduł renderu (cel) | importów | nazwy | importujący (src/game/…) | rodzaj |
|---|---|---|---|---|
| `3d/haloRing/haloRingConfig.js` | 4 | HALO_PORT, HALO_TRANSIT, haloPortComplexAngles, haloTransitAngles, HALO_STATION_ANGLE | cargoPortOps.js:32, haloRingCollision.js:18, haloRingPlanets.js:15, story/k7Dock.js:10 | czyste dane / geometria (bez three) |
| `3d/haloRing/haloPortBays.js` | 2 | HALO_BAY, haloBayLayouts | cargoPortOps.js:33, haloRingCollision.js:20 | czyste dane / geometria (bez three) |
| `3d/haloRing/haloPortDocking.js` | 2 | PORT_SEQUENCE, buildPortCollision, createPortRegistry | cargoPortOps.js:34, haloRingCollision.js:21 | czyste dane / geometria (bez three) |
| `3d/haloRing/haloPortK7Layout.js` | 7 | K7_BANK_SLOTS, k7HeightToZ, createK7Layout, K7_HEIGHTS, k7Frame, K7_SERVICE_DOCK, K7_SERVICE_KEYS, K7_SERVICE_RELEASE, k7AngleDelta, k7ServiceConnectPose, k7ServiceDisconnectPose, k7HeadingToWorld, k7HubToWorld, k7WorldToHub, K7_SERVICE_UNDOCK, k7ServiceStep | cargoPortOps.js:35, hallDustInput.js:14, haloRingCollision.js:19, haloRingPlanets.js:17, k7BerthService.js:23, story/k7Dock.js:9, story/storyGame.js:26 | czyste dane / geometria (bez three) |
| `vfx/collisionFx.js` | 2 | CollisionFX, impactEvent, grindEvent | destructor.js:10, hullBodies.js:31 | szyna zderzeń (stan: słuchacze) |
| `3d/gasField/hallDustLayout.js` | 1 | HALL_DUST_IN, HALL_DUST_MASK, HALL_DUST_MAX_SHIPS, HALL_DUST_SERVICE, HALL_DUST_SERVICE_BERTHS, HALL_DUST_SHIP, hallDustDomain, hallDomainDistance | hallDustInput.js:10 | czyste dane / geometria (bez three) |
| `3d/haloRing/haloRingLayout.js` | 1 | createHaloRingLayout | haloRingPlanets.js:16 | czyste dane / geometria (bez three) |
| `3d/ringScale.js` | 1 | normalizeRingPlanetKey, resolveRingPlanetWorldRadius | haloRingPlanets.js:18 | czyste dane / geometria (bez three) |
| `3d/fx/fxRandom.js` | 2 | fxRandom | hullBodies.js:33, superweapon.js:17 | generator (stan) |
| `3d/hullDamageStamps.js` | 1 | craterRadiusFor, trenchRadiusFor | hullCraters.js:14 | czyste dane / geometria (bez three) |
| `3d/portBuildings/pirateDryDockChunks.js` | 1 | dryDockChunkSolids, dryDockPlanarSolids, dryDockTopRaster | story/pirateDryDockBodies.js:18 | czyste dane / geometria (bez three) |
| `3d/portBuildings/pirateDryDockLayout.js` | 2 | createPirateDryDockLayout, dryDockShipPose, pointInPoly, dryDockChunkAt, dryDockNearestChunk, planDryDockChain | story/shipyardLayout.js:16, story/storyGame.js:23 | czyste dane / geometria (bez three) |
| `3d/weapons/weaponFx.js` | 1 | WeaponFx | superweapon.js:12 | efekty (stan GPU) |
| `3d/haloRing/haloPortTraffic.js` | 1 | buildHaloPortTrafficLayout | traffic/trafficWorld.js:42 | czyste dane / geometria (bez three) |
| `vfx/turret2D.js` | 1 | Turret2D | weaponController.js:5 | wieżyczki 2D (stan rekordów) |

**Render → symulacja: 105 importów z 52 modułów renderu do 39 modułów `src/game`** (+ 28 importów do 8 modułów
`src/data` — czyste dane, wspólne). Klasy:
- **A — czyste dane i matematyka (24):** worker importuje je bez zmian (część pisze `window.*` przy imporcie — strażnik
  RW-01 to wyłapie).
- **B — zegary i kontenery klatki (4):** `simClock`, `gameState`, `view3D`, `carrierVelocity` (`ActiveCarrier` — „bieżący
  nośnik” jako stan modułu) — w workerze zasilane z migawki i rekordów.
- **C — stan rozgrywki czytany przez render (3):** `hullBodies` (rejestr ciał i magazyny węzłów; render woła też
  `probe`, `spriteUvAt`, `structureFor`, `anchorLocalX/Y`), `worldBodies`, `destructor` (ścieżka heksów — w grze martwa)
  — w workerze lustra z migawki.
- **D — rozgrywka tworzona albo krokowana przez moduły 3D (7):** `asteroidMining`, `asteroidMiningRig`,
  `asteroidBeltGiants`, `asteroidGiantBuilder` (tworzy je `asteroidBelt.js`), `haloRingCollision`, `k7BerthService`
  (tworzy i krokuje `haloRingGame.js`), `story/pirateDryDockBodies` (wołane z `pirateDryDockGame.js`) — do wyjęcia
  (RW-24, RW-25, RW-27).
- **E — szyna zdarzeń (1):** `weaponShotBus` — dziś słucha jej `WeaponFx`; w workerze słuchacz zamienia się w pisarza rekordów.

| klasa | moduł (src/game/…) | importów z renderu | nazwy | importujące moduły renderu |
|---|---|---|---|---|
| A | `cloakLook.js` | 8 | CLOAK_EVENT, CLOAK_BAND, CLOAK_GLITCH_DROP, CLOAK_HEX_RY, CLOAK_ID_OFFSET, CLOAK_TV_LOCK0, CLOAK_TV_LOCK1, CLOAK_TV_SHARE, CLOAK_TV_U0, CLOAK_LOOK_OFF, createCloakLook, stepCloakLook, cloakVisAtWorld, cloakLightGain, entityCloakVisAt | 3d/cloak/cloakFx.js, 3d/cloak/cloakTSL.js, 3d/cloak/hullCloak.js, 3d/engineVfxSystem.js, 3d/fx/lightGrid.js, 3d/hexShips3D.tsl.js, 3d/ships3d/shipModels3DGame.js, vfx/turret2D.js |
| A | `shipBridge.js` | 3 | BRIDGE_KILL_TIMELINE, BRIDGE_LAYOUT_PROPOSALS, bridgeGridToWorld, bridgeHash01, bridgeWaveDelay, sampleNavLight, sampleWindowLight, bridgePngToWorld, bridgeShardIsAlive, sampleVentStrength | 3d/bridge3D.js, 3d/bridge3DShapes.js, 3d/bridgeFx3D.js |
| A | `warpDrive.js` | 3 | createWarpArrival, sampleWarpArrival, planWarpRush, sampleWarpRush, warpBrakeTime, warpBrakeBubbleFront, createWarpDeparture, sampleWarpDeparture, WARP_EXIT, warpArrivalSpeed, warpRulonBend, warpSizeScale, planWarpFleetArrival | 3d/warp/arrivals.js, 3d/warp/player.js, 3d/warp/warpNurt.js |
| A | `coreModel.js` | 2 | CORE_STATE | 3d/coreBands.js, 3d/reactorBlast/reactorBlastFx.js |
| A | `shipBridgeBeams.js` | 2 | beamImageToLattice, beamLatticeToWorld, bridgeBeamHull, bridgeCellNode, isBeamBridgeState, beamWindowNode, beamWindowWorld | 3d/bridge3D.js, 3d/bridgeFx3D.js |
| A | `hullMounts.js` | 2 | beginHullMountBind, bindHullMount, createHullMountSet, mountHullOf, refreshHullMountSet | 3d/engineVfxSystem.js, 3d/fx/lightGrid.js |
| A | `traffic/dockLayout.js` | 2 | BERTH_CLASSES, BERTH_ROLE | 3d/haloRing/haloPortTraffic.js, 3d/portBuildings/portModuleTraffic.js |
| A | `haloRingPlanets.js` | 2 | haloRingKey, haloRingRotation, HALO_RING_PLANETS, haloGameToLocal | 3d/haloRing/haloPortTraffic.js, 3d/haloRing/haloRingGame.js |
| A | `traffic/shipyards.js` | 2 | WARSHIP_CLASSES | 3d/portBuildings/portShipyardLayout.js, 3d/portBuildings/portShipyardSwarm.js |
| A | `weaponFeel.js` | 2 | weaponImpactScale, weaponRecoil, weaponShake | 3d/weapons/weaponFx.js, vfx/turret2D.js |
| A | `asteroidRockKinds.js` | 5 | ROCK_TYPES, ROCK_TYPE_INDEX, SHAPE_COUNT, SHAPE_VARIANTS, FAMILY, ENERGY_TYPE | 3d/asteroids/minedRocks.js, 3d/asteroids/minerals.js, 3d/asteroids/rockBank.js, 3d/asteroids/rockMaterial.js, 3d/asteroids/storm.js |
| A | `asteroidGiants.js` | 1 | BAND_VOXELS | 3d/asteroids/giants.js |
| A | `coldWrecks.js` | 1 | COLD_WRECK_CONFIG | 3d/hexShips3D.js |
| A | `skyRegion.js` | 1 | skyRegionBrightness, stepSkyRegion | 3d/planet3d.assets.js |
| A | `shipBridgeRuntime.js` | 1 | resolveBridgeHullKey | 3d/bridge3D.js |
| A | `hullCraters.js` | 1 | rocketHullContact | 3d/rockets/effects.js |
| A | `weaponAim.js` | 1 | mountedWeaponRenderAngle | vfx/turret2D.js |
| A | `cargoPortOps.js` | 1 | CARGO_DRONE, CARGO_DRONE_STRIDE, CARGO_PHASE | 3d/portBuildings/portShipyardSwarm.js |
| A | `shipLightRuntime.js` | 5 | getEntityHullLengthWorld, buildNavLightClusters, buildRoadLightWorldEmitters, entityOwnRoadLightCount, MAX_SHADER_SHIP_LIGHTS, buildCombinedShipLightShaderPayload, buildPositionLightWorldSprites, buildShipLightShaderPayload, buildExternalLightIndex, computeRoadEmitterReach, createExternalLightIndex, createRoadEmitterReach, hasEntityLightSource, roadEmittersMayReach, NAV_LIGHT_CHASE, MAX_NAV_LIGHT_SPRITES | 3d/asteroids/asteroidBelt.js, 3d/fx/lightGrid.js, 3d/hexShips3D.js, 3d/hexShips3D.tsl.js, 3d/shipLights3D.js |
| A | `reactorCore.js` | 1 | reactorCoreWorld, reactorCellWorld, reactorHull | 3d/reactorBlast/reactorBlastFx.js |
| A | `shipCore.js` | 1 | CORE_STATE, coreStateRank, gridToLocal, localToWorld | 3d/reactor3D.js |
| A | `asteroidStorms.js` | 3 | stormIntensity, StormSimulator, sheetEnvelope, mulberry32 | 3d/asteroids/fieldMap.js, 3d/asteroids/fog.js, 3d/asteroids/storm.js |
| A | `asteroidBeltField.js` | 1 | AsteroidBeltField, BELT_BAND | 3d/asteroids/asteroidBelt.js |
| A | `asteroidFieldLight.js` | 1 | FieldSunOcclusion | 3d/asteroids/asteroidBelt.js |
| B | `simClock.js` | 14 | SimClock, CLOCK_SIM, CLOCK_RENDER | 3d/bridgeFx3D.js, 3d/explosions/explosionFx.js, 3d/fx/carrier.js, 3d/fx/fxFrame.js, 3d/fx/fxLights.js, 3d/fxParticles3D.js, 3d/hullDamageMap.js, 3d/reactorBlast/reactorBlastFx.js, 3d/rockets/effects.js, 3d/sparkSystem3D.js, 3d/weapons/trails.js, 3d/weapons/weaponFx.js, effects3d/rocketSystem3D.js, vfx/canvasParticleSystem.js |
| B | `gameState.js` | 2 | GameState | 3d/engineVfxSystem.js, 3d/warp/warpNurt.js |
| B | `view3D.js` | 1 | View3D | 3d/asteroids/asteroidBelt.js |
| B | `carrierVelocity.js` | 15 | ActiveCarrier, writeCarrier, createCarrier, writeCarrierVelocity, writePointVelocity | 3d/bridgeFx3D.js, 3d/cloak/cloakFx.js, 3d/explosions/explosionFx.js, 3d/fx/carrier.js, 3d/fx/fxLights.js, 3d/fxParticles3D.js, 3d/hullDamageMap.js, 3d/reactorBlast/reactorBlastFx.js, 3d/shield3D.js, 3d/sideJets3D.js, 3d/sparkSystem3D.js, 3d/weapons/gpuFx.js, 3d/weapons/weaponFx.js, effects3d/rocketSystem3D.js, vfx/canvasParticleSystem.js |
| C | `hullBodies.js` | 8 | HULL_BODY_CONFIG, HullBodies, hullSpriteRotation | 3d/bridge3D.js, 3d/bridgeFx3D.js, 3d/cloak/hullCloak.js, 3d/hexShips3D.js, 3d/hullDamageMap.js, 3d/reactorBlast/reactorBlastFx.js, 3d/ships3d/shipModels3DGame.js, 3d/worldBodies3D.js |
| C | `worldBodies.js` | 2 | worldBodies | 3d/pirateDryDockGame.js, 3d/worldBodies3D.js |
| C | `destructor.js` | 2 | DESTRUCTOR_CONFIG, shardHeatNow, refreshHexBodyCache, DestructorSystem, isPackedShardBoundary | 3d/bridge3D.js, 3d/hexShips3D.js |
| D | `asteroidMining.js` | 1 | AsteroidMining | 3d/asteroids/asteroidBelt.js |
| D | `asteroidMiningRig.js` | 2 | MiningRig, MINING_FX | 3d/asteroids/asteroidBelt.js, 3d/asteroids/miningView.js |
| D | `asteroidBeltGiants.js` | 1 | BeltGiants | 3d/asteroids/asteroidBelt.js |
| D | `asteroidGiantBuilder.js` | 1 | GiantBuilder | 3d/asteroids/asteroidBelt.js |
| D | `haloRingCollision.js` | 1 | HaloRingCollider | 3d/haloRing/haloRingGame.js |
| D | `k7BerthService.js` | 1 | createK7BerthService, stepK7BerthService, syncK7BerthLamps | 3d/haloRing/haloRingGame.js |
| D | `story/pirateDryDockBodies.js` | 1 | createPirateDryDockSite, prebuildPirateDryDockBodies | 3d/pirateDryDockGame.js |
| E | `weaponShotBus.js` | 1 | WeaponShotBus | 3d/weapons/weaponFx.js |

Poza tym: `src/ui` importuje render 2 razy (`bloomConfig.js`, przełącznik zabarwienia w `devTools.js`); render nie
importuje `src/ui`.

### 2.3 Moduły 3D aktualizowane w `render()`: co czytają i ile to danych

Kolejność w klatce (`index.html`): `loop` → `pumpInput` → `physicsStep` × N → rakiety `rocketSystem3D.update(frame)`
(`25198`, w `loop`) → `StoryGame.tick` → `stepSupportWarp` → `render()`: kamera (rig, wstrząs, `Game3D.frame`,
`Core3D.syncCamera`) → `WarpNurt.update` → `setSkyZone`, `updatePlanets3D` → `SpaceDust3D.frame` → `haloRings.update` →
`updateStations3D` → `updateWorld3D`, `updatePirateDryDock3D`, `syncWorldBodies3D` → `asteroidBelt.prepareFrame` →
`packHallDustFrame` + `HallDust.submit` → `Destruction3D.update` → `applyBridgeHulkVisuals` (gra) → `Bridge3D.update`,
`BridgeFx3D.update` → `updateHexShips3D` (w środku: maskowanie, lampy, skóry, cień, `Turret2D.sync`, `WeaponFx.sync`,
dysze) → `syncShipModels3D` → `updateShields3D` → rdzenie reaktorów → `drawHexShips3D` (render Core3D z krokami
`Core3D.fx` i kopia na kanwę 2D) → nakładki 2D.

**Zbiorczo — bitwa referencyjna** (166 okrętów + ~90 wraków; 44 601 węzłów belek; ~250 wież w kadrze; do ~150
pocisków w locie):

| moduł (wejście) | dane na klatkę | jednorazowo / przy zmianie | rozgrywka w module |
|---|---|---|---|
| kadłuby: skóra, lampy, cień SDF, smugi (`updateHexShips3D`, `26265`) | pozy ~11 KB, skalary kadłubów ~10 KB; węzły: 0 dla okrętu w locie (węzły w układzie ciała), zmienione ciała — od kilku KB do ~0,7–1,5 MB przy pełnym rozpadzie floty (x, y, active, żar) | topologia magazynu 60–100 B / węzeł na konstrukcję (wspólna dla typu), obrazy kadłubów | bramka zimnych wraków |
| dysze (`EngineVfxSystem`, w `updateHexShips3D`) | ~10 KB (784 dysze × 8 B + stery 166 × 24 B; NPC zmieniają je co 1/30 s) | układ dysz na typ | — |
| maskowanie, wieże (`updateCloakLooks`, `Turret2D.sync`) | stan maskowania na encję z maskowaniem; ~8 KB rekordów wież | gniazda | stan dla kanwy 2D |
| pociski (`WeaponFx.sync`) | 150–300 × ~60 B ≈ 9–18 KB | — | flaga `__renderedByThree` |
| mostki (`Bridge3D`, `BridgeFx3D`, `26265–26266`) | ~0,1 KB własnych + hp / żar węzłów pod modelem (z bloku węzłów) | stan statyczny 1–3 KB na kadłub (~0,2–0,5 MB raz) | — |
| tarcze (`updateShields3D`, `26281`) | ~3 KB + trafienia ~20 B × 5–30 | profil 396 B na kształt | przebicia (zwrot ≤ 6,5 KB co 0,1 s) |
| modele 3D (`syncShipModels3D`, `26271`) | domyślnie 0; z opcją „Statki / Bronie 3D” ~1,2 KB kątów luf + te same węzły | gniazda ~3,5 KB | — |
| rdzenie reaktorów (`26288–26302`) | ≤ 3 KB + strugi i kule ≤ 0,5 KB | rdzenie 25–60 KB | — |
| stacje, rozpad, stacja piracka (`26149`, `26156`, `26195`) | ~0,2 KB | GLB, tekstury | `station._mesh3d` jako warunek gry |
| ring „Halo” i K-7 (`26134`) | ~1,3 KB (kamera, gracz, pozy 3 × 16 × 6 f32, lampki, zegar) | mapa Ziemi 3 MB (grze potrzebne 16 KB) | kolider, teren, automat stanowisk |
| pas asteroid (`26173`) | ~0,1 KB (7 statków ze światłami) | SDF olbrzymów ~52 MB, cień pól ~12 MB, mapy promienia 640 KB | wydobycie, olbrzymy, zegar skał |
| suchy dok i ciała świata (`26159–26161`) | ~80 B bez zdarzeń; taran 7–17 KB; łańcuch rozpadu 27–90 KB (sufit ~255 KB) | kratownice ~110 KB | stan kawałków, `_dockGone`, ciała |
| warp „Nurt” (`26118`) | ~50 B + zdarzenia 10–60 B | — | zegar spawnu, prowadzenie okrętów |
| pył kosmiczny, planety, niebo (`26119–26124`) | ~0,1 KB (kamera w HEAD) | init planet | — |
| pył hal K-7 (`26178–26188`) | 10,5 KB (maski 8 KB — wystarczy przy zmianie) | — | — (przecieki zegara, lamp, póz) |
| rakiety — obraz (`25198`) | ~16 liczb × aktywne rakiety (setki) ≈ 10–30 KB | — | cały lot w module (RW-23) |
| tło menu (`2428…`) | — | — | synchroniczne bramki startu |

Razem bez węzłów: ~100–150 KB na klatkę, plus węzły ciał zmienionych od ostatniej klatki odebranej przez worker.
Szczegóły modułów (plik:linia przy każdej tezie):

**Kadłuby — `updateHexShips3D(cam, renderEntities, _hexCullInfo, coldWrecks)`** (`hexShips3D.js:2024–2328`,
wołane `index.html:26265` raz na klatkę rAF, także w pauzie i pod CIC). Lista `renderEntities` to referencje
obiektów gry (render zapisuje `ship.isPlayer = true`, `index.html:26199`); `_hexCullInfo` = pudło rozgrzania (×3,
9 ekranów) i kadr; w kamerach 3D `View3D.groundBox`. Przed nią `applyBridgeHulkVisuals` (gra) pisze `__throttle`,
`vfxScale` dysz i podmienia `entity.editorLights`; wcześniej w klatce `WarpNurt.update` zapisuje na encji
`__warpHullU` i `__warpNurtMode` (`warpNurt.js:770`, `854`, `880`, `916`), które czytają materiał kadłuba i dysze —
przepływ render → render przez obiekt gry. Ścieżka heksowa (`createEntityMesh` / `updateEntityMesh`,
`hexShips3D.js:985–1564`, `GpuDebrisPool`, `refreshHexBodyCache`) jest w grze martwa.

| krok | co czyta / pisze |
|---|---|
| zegar (`:2027`) | `performance.now()` → `state.lastTime` (uTime, żar skóry, sekwencja lamp) |
| kamera (`:2031`) | `Core3D.syncCamera(cam)`; `core3d.js:1354` czyta `window.camera2` |
| strojenie | `window.__shipLightTune`, `HullBodies.config.heatDecay / heatGlowPeak`, `HullLacquer.update` (`window.warp.state`), `HullLighting.update`, `HullSurface.pump`; ustawia `Turret2D.lightAt` |
| selekcja (`:2085–2123`) | `dead, hideHexVisual, visual.hideHexMesh`, ciało (`hull.entity, body.dead, body.activeNodes`), mgła `SensorSystem.hides(e)` (predykat z gry), `pos / x, y`, `radius`, pudło z `beamHull.pivot / srcWidth / srcHeight` + `visual.spriteScale*`; PISZE `entity.__hiddenFromView` |
| skóra belek (`:1629`, `:1751`, `beamHullSkin.js`, `HullSkinBatch`, `HullObjectStore`) | rekord kadłuba (`hullBodies.js:408–440`: `entity, body, dmgKey, world, isFragment, anchorMode, anchorDX/DY, scale, cellSize, pixelPitch, ny, srcWidth/Height, pivot`; obrazy `image / visualImage / normalMapImage` — TOŻSAMOŚĆ obiektów DOM to klucz tekstury i partii), poza (gracz z interpolacji, `hullSpriteRotation`, `anchorLocalX/Y`), wrak / odłam (`body._boundsMinMax`, `DevTuning.wreckImpostorPx`); magazyny (`beamStore3D.js:49–66`): topologia raz (`ix, iy`, belki `a, b`, `spriteSkin`), czworokąty z `x, y, ox, oy, heat, heatStamp` (Float64), `active` (Uint8), `adj / adjStart`, `broken`, `rest / restBase`; BRUDNY ZAKRES `_region.dirty[0..dirtyCount)` (węzeł + 8 sąsiadów) albo cały magazyn przy podmianie magazynu (rozpad, odrost), `region.dirtyAll` (m.in. `_recentre` po uspokojeniu każdego trafienia — jednorodne przesunięcie wszystkich węzłów, `destructorBeams3D.js:949`, `1013`), `shiftBodyOrigin` |
| render → gra | `body.meshDirty = false`, `clearHullSkinDirty` (`nodeStore.skinDirty[i] = 0`, `region.dirtyAll = false`, `dirtyCount = 0`; `beamHullSkin.js:153–164`) — RENDER czyści flagi gry (gra tylko znakuje, `beamActiveRegion3D.js:67–83`); poza kadrem lista narasta |
| wartości per kadłub | `HullObjectStore.commit` czyta gettery `entity.__warpHullU`, `entity.__cloakLook`, `window.SUN`, `HullDamageMap.bind(hull.dmgKey)`, strefy dysz z `visual.mainThrusters / torqueThrusters` |
| lampy (`src/game/shipLightRuntime.js` + `ShipLights3D` + `HullLightStore`) | emitery reflektorów (≤ 128) i grupy lamp (≤ 256) z pudła rozgrzania, billboardy (≤ 512) z kadru; źródło `editorLights ‖ visual.lights ‖ capitalProfile.lights`, `__hardpointScale*`, `roadLightsOff`, kąt, skala, ród `dmgKey`, `__cloakLook`; żywotność mocowań (`hullMounts.js`: `HullBodies.structureFor`, `D._latticeIndex(body)` — cache `body._lattice` na ciele gry) |
| cień SDF (`hullShadowSdf.js`; `:2207–2269`) | kandydaci z `valid` bez cullingu kadru; `beamShadowGrid` kopiuje `ox/oy` raz, `cellActive` to ŻYWY widok `nodeStore.active`; PISZE `hull._shadowGrid`; pieczenie ≤ 2 na klatkę (budżet 2,5 ms) z mapą alfy obrazu (`getImageData`); **`window.innerWidth/innerHeight` bez osłony `typeof` (`:2212`) — w workerze `ReferenceError`** |
| smugi i zimne wraki | `computeAverageBodyColor` (`hexBodyImpostorBatch.js:112–150`, kanwa przez `document`); `captureColdWreckImpostor` PISZE `snapshot.color / impostor` do obiektu gry; `isColdFreezeVisuallySafe` (`:2458–2471`) — prawda, gdy wrak poza pudłem rysowania OSTATNIEJ klatki albo w LOD `batchedImpostor` (< 15 px) |
| maskowanie (`hullCloak.js`) | `updateCloakLooks(valid, now, getPose, zoomPx, window.ship)` czyta `e.cloak{state, level, energy, lastBreak}` (`lastBreak` porównywany po TOŻSAMOŚCI obiektu), pozę z kadłuba, `window.splitScreenMode`; PISZE `e.__cloakLook` (mutowany co klatkę) — czytają go `Turret2D.draw` (wątek główny, `turret2D.js:1174`) i `cloakLightGain` (widoczność mostka, `index.html:5040`); `CloakFx` pyta `HullBodies.probe` |
| wieże i pociski | `Turret2D.beginFrame / sync / update` (`:2276–2291`, tylko kadr) — rekordy dla kanwy 2D, WeaponFx, rakiet i modeli 3D; `WeaponFx.sync(window.bullets)` (`:2294`) |
| odłamki | gra → render `window.spawnHullDebris(…)` (`hullBodies.js:2191–2193`, skala z `fxRandom` po stronie gry) |
| diagnostyka | `window.__hexLodStats` (czyta `perfHud.js:1360`) |

**Dysze — `EngineVfxSystem.update(visibleVfx)`** (`engineVfxSystem.js:879–957`, z `hexShips3D.js:2323`; dt z
`performance.now()`, więc biegnie też w pauzie). Układ (przy podmianie tablic): `visual.mainThrusters[] /
torqueThrusters[]` (`offset, forward, baseDeg, gimbalMin/MaxDeg, mount, side`), `visual.engineFx` (brak → zapas
zapisany jako `entity.__engineFxFallback`, czyta też `warp/palette.js:42`). Co klatkę: poza, skala, klasa,
`vx / vel`, `thrusterInput.{main, leftSide, rightSide, torque}`, `input.{main, thrustY}`, `capitalProfile.*`,
`radius, isPlayer, isBridgeHulk`; na dyszę `__throttle`, `vfxScale`, `nozzleDeg`; warp (`GameState.warp.{state,
exitRamp}`, NPC `state === 'warping_in' ‖ phase === 'warping'`, `__warpPreview`, `__warpNurtMode`), dopalacz
(`GameState.boost`, `GameState.ramBurn`), `OPTIONS.vfx.bloomGain`, `VFX_TUNE.side*`, `shipDriveState.engineColorTempK`,
`__cloakLook`. Gracz zmienia `__throttle` / `nozzleDeg` co krok, NPC co 1/30 s (`shipFlightModel.js:558–590`).
Wyjścia `EngineFrame` / `SideNozzleFrame` czyta tylko render (pył, pył hal, modele 3D, światła poszycia).

**Mapa ran — haki wołane z fizyki** (`hullDamageMap.js`): `onHullImpact` (`hullBodies.js:649/698`), `onHullNodeLost`
(`:2185`), `onHullRepair` (`:528`, `1230`), `setSource / clearSource` (`index.html:9458/9462`), `stampKerf`
(`index.html:11121`; `HullBodies.spriteUvAt`, `entityPose`), `stampRecipe` (receptury). Haki MUTUJĄ stan renderu
synchronicznie w kroku fizyki (`_offView` z `Core3D.fx.view` ostatniej klatki efektów, LRU slotów, kolejka stempli
64 B, `fxRandom`); dedup krater ↔ receptura w obrębie jednej klatki — rekordy fizyki muszą być odtwarzane przed
recepturami tej samej klatki. Gra nie czyta wyników.

**`drawHexShips3D(ctx, W, H)`** (`:2351–2407`): `Core3D.renderSingle(activeCam1)` + `ctx.drawImage(Core3D.canvas)`
w tym samym zadaniu; podzielony ekran — dwa pełne rendery i środkowe połowy; wynik `window.__hexShips3DLastDrawPerf`.

**Rozmiary (bitwa ~257 encji: 166 okrętów, ~90 wraków, gracz):**

| strumień | rekordy | B / rek. | na klatkę |
|---|---|---|---|
| poza encji (x, y f64; kąt, vx, vy, ω, z f32; id, flagi) | ~257 | ~44 | ~11 KB |
| skalary kadłuba (`activeNodes`, generacja magazynu, `latticeMin`, granice, pivot) | ~257 | ~40 | ~10 KB (zmiany rzadkie) |
| dysze: `nozzleDeg` + `__throttle` | 784 (453 MAIN + 331 SIDE) | 8 | ~6 KB (NPC 30 Hz) |
| `thrusterInput` + `input` | 166 | 24 | ~4 KB |
| skóra — delta węzła (x, y, żar, stempel, active, indeks) | D (do zmierzenia: Σ `region.dirtyCount`) | 21 (+ ~40 belek sąsiednich) | szac. 20–300 KB |
| skóra — cała flota (górna granica) | 44 601 węzłów + ~181 tys. belek | 17 / 5 | ~0,76 + ~0,9 MB |
| topologia magazynów | per konstrukcja (wspólna dla typu — `cloneStructure`, `hullBodies.js:203`) | 60–100 B / węzeł | jednorazowo |
| rekordy wież | ~250 (w kadrze; `Turret2D` do ~1500) | ~32 | ~8 KB |
| stemple mapy ran / odłamki | 10–100 na klatkę (rozpad: setki) | 64 / ~40 | 1–30 KB |

Lampy z edytora (`hardpointEditorDefaults.js`): Atlas 42 pozycyjne + 2 reflektory, niszczyciel TN 24 + 1, fregata TN
8, supercapital TN 12, piraci 0; do tego do 5 reflektorów z obrysu. Dysze MAIN / SIDE: fregata 2/2, niszczyciel TN
4/4 (piraci 3/0), pancernik 4/0, supercapital TN 7/13 (piraci 4/4), Atlas 5/8.

**Mostki** — `Bridge3D.update(renderSeen, {nowSec: bridgeSimTime, dt, zoom, poseOf: bridgeRenderPose, cull, camera,
visibility: bridgeModelVisibility})` i `BridgeFx3D.update(…)` (`index.html:26265–26266`; przed nimi
`applyBridgeHulkVisuals` — moduł GRY, `shipBridge.js:1388`, pisze dławienie dysz `visual.mainThrusters[i].__throttle`,
`vfxScale`, `entity.editorLights` — zostaje przed migawką). Czyta: encję (`dead, bridgeState, beamHull`, poza,
`visual.spriteScaleX`, `vx/vy`, `type / shipFrame / isPirate`), `bridgeState` statyczny po montażu (`backend` —
porównanie TOŻSAMOŚCI z obiektem `BEAM_BRIDGE_BACKEND`, `lineage, hullKey, srcW/H, spriteScale, anchorDX/DY,
cellSize, bridges[].{def, total, missing, cellX, cellY}, windows{…}` — `shipBridgeBeams.js:170`) i zmienny
(`commandLost, commandLostAt, vent, bridges[].{dead, deadAt, vent}`), magazyn węzłów (`active, hp, maxHp, heat,
heatStamp` komórek pod modelem — przy zmianie ciała albo co 1 s; hp węzła pod oknem — co klatkę; `HullBodies.probe`
w łukach agonii, `bridgeFx3D.js:419`), `window.SUN`. Pisze tylko pola własne (`st.model3D`, `e.__bridge3D*`,
`st.windows.lit`) i cache `body._lattice` (przez `D._latticeIndex`, `destructorBeams3D.js:1957` — render buduje cache
w ciele fizyki). Zegar żaru: `heatStamp` pisze silnik belek zegarem `performance.now()` wątku głównego
(`destructorBeams3D.js:303`), a `ctx.heatNow = performance.now()/1000` (`bridge3D.js:1434`) — w workerze inny
`timeOrigin`, więc `heatNow` musi przyjść w migawce. Dane: statyczne ~1–3 KB na kadłub (≈ 0,2–0,5 MB na 166
okrętów, raz), co klatkę ~50 KB odczytu okien i 30–300 komórek × ~25 B dla 3–10 rekordów.

**Tarcze** — `updateShields3D(dt, renderSeen, window.__interpShipPose)` (`index.html:26281`) + krok `Core3D.fx`
„tarcze”. Czyta: `shield.{max, val, state, activationProgress, hardness, show, forceOff, impacts[]{id, gridAngle,
damage, intensity, fxClass}}` (trafienia nowsze niż `lastImpactId`), profil obrysu `getEntityShieldProfile`
(`shield3D.js:291` — z `beamHull.body.nodeStore.{count, ox, oy}`, `latticeMin`, kotwicy; cache na encji wspólny z grą),
koło zapasowe (`w, h, radius, sprite*, type, shipFrame, capitalProfile…`), `window.DevFlags.globalShieldsOff`.
Trafienia wpisuje gra (`registerShieldImpact`, `shieldSystem.js:542` ← wiązki `index.html:10038`, pociski `21725`,
rakiety `rocketSystem3D.js:1223`). Dane: stan ~19 B × 166 ≈ 3 KB/klatkę, trafienia ~20 B × 5–30, profil 396 B na
kształt (przy zmianie), zwrot przebić ≤ 6,5 KB co 0,1 s. Zegar tarcz biegnie w scenach fabuły (`PAUSED ? 0 : frameDt`
nie zeruje `worldFrozen`).

**Modele 3D statków i broni** — `setShipModels3DView`, `syncShotVisualHeights` (wątek główny, ale czyta stan wież 3D
przez `turretMuzzleZ` i pisze `b.visZ0`, `b.z` — do workera), `syncShipModels3D({entities: renderSeen, poseOf,
turrets: Turret2D, inView, zoom, zoomAt, dt})` (`index.html:26271`, po kadłubach). Czyta: encję (`dead, isWreck,
isPlayer`, poza, `spriteScaleX, lightsOff, roadLightsOff, weaponTier, id|name, radius, model3DProfileId, shipFrame,
activeHullId, type, isPirate, __cloakLook`), cały magazyn węzłów `nodeStore.{count, active, ix, iy, iz, x, y, z}`
(skóra FFD `hullSkin3D.js:497` co klatkę dla nieśpiących ciał), `HullBodies.structureFor` (raz na klasę), rekordy
`Turret2D` (`key, weaponId, wx, wy, ang, spec.r, scale, recoil, state.barrel`). Opcje (`configureShipModels3D`,
`model3DIdOf` — gra, cache `e.__model3DIdResolved`) z `localStorage`. Domyślnie (opcje wyłączone, kamera z góry)
tylko dysze SIDE; z opcjami do ~535 KB pozycji węzłów (ten sam magazyn co kadłuby), ~1,2 KB kątów luf na klatkę.

**Rdzenie reaktorów** — `ReactorGame.cores(…)` (`reactorCoreGame.js:314`) → `reactorBlastFx.advance / syncCores /
syncHazards` i `reactorModel3D.sync(cores, 0, dt, {origin: cam})` (`index.html:26288–26302`); zdarzenia z
`ReactorGame.step` (`index.html:24201`) i `hostKilled` (`20649`, `20978`) przez `env.fx()`. Czyta rdzeń (statyczne
`uid, lineage, gx, gy, gridR, color, classId, cellX/Y`; zmienne `state, host, integrity, meltdownRemaining/Duration,
deadCount, elsewhereCount, cellState[]`), gospodarza (poza, prędkość, frakcja; `HullBodies.probe`,
`reactorBlastFx.js:451`), ŻYWE strugi i kule (`reactorCore.js:1114`, `1219`) mutowane co krok. Pisze `core.lastX/lastY`
(cache pozy) i `camera.addShake` przez `onShake`. **`reactor3D.js:299–300` losuje `Math.random()` gry** (łamie zasadę
fxRandom) — w workerze przestanie przesuwać losowania rozgrywki, więc zmienią się przebiegi harnessu. Dane: rdzenie
statyczne 25–60 KB (raz), stan 256 B + pełne rekordy od EXPOSED ≤ 3 KB/klatkę, detonacja 1–4 KB/zdarzenie.

**Stacje, rozpad, stacja piracka** — `updateStations3D(stations)` (wszystkie stacje, bez pudła kadru),
`updateWorld3D(frameDt, vfxTime)`, `Destruction3D.update(vfxTime, frameDt)`; zdarzenia z `applyDamageToStation`
(`index.html:21118`): progi 75/50/25 % → `Destruction3D.detachChunk(station._mesh3d)` (gra trzyma mesh three
i używa go jako warunku, `21142–21146`), śmierć → `station._destroyed3D` + `destroyStation3D`. Czyta: stację
(statyczne `id, name, style, planet, isPirate, faction, ringPort…`; co klatkę `x, y, angle, r`, `_destroyed3D`),
`SensorSystem.hides(st)` (gra, co klatkę, `world3d.js:146`). `spinOffset += 0.002` na klatkę bez dt
(`stations3D.js:379` — obrót zależy od fps renderu), `Destruction3D` nie zeruje `frameDt` w pauzie (odłamki dryfują).
`pirateStationFactory.js:25/51/70/92` tworzy kanwy przez `document` — w workerze brak tekstur i inny ciąg losowań
(inna stacja). Dane ~0,2 KB/klatkę.

**Pas asteroid** (`src/3d/asteroids/asteroidBelt.js`): konstruktor (bez GPU) tworzy `AsteroidBeltField`,
`FieldSunOcclusion`, `BeltGiants` + `GiantBuilder` z `src/game` (`:124–131`); `precompute` ~1 s CPU (`:199–204`);
`initGpu` (`:211–301`) — dopiero tu powstają `mining`, `rig` i wspólny zbiór `hidden = rig.taken` (`:278–280`);
`prepareFrame(frameDt, ship, p2, npcs, PAUSED)` (`index.html:26173`) przekazuje referencje, liczenie w kroku
`Core3D.fx`. Czyta: statki (`dead, destroyed, fighter, pos, w, radius`; światła pola dla gracza i ≤ 6 innych:
`__cloakLook, angle, roadLightsOff`, lampy z `shipLightRuntime.js`), kamerę (`Core3D.activeCam1`,
`window.splitScreenMode / camera2`, `View3D.groundBox`). Użycia w `index.html`: obraz (tworzenie `10947–10950`,
`prepareFrame`, `precompute` / `initGpu` `28713–28717`, statystyki), rozgrywka (`field.sampleMacro` — miejsce przylotu
piratów `8465`; `giants.readyCount` i `pointBlocked` — pociski `21836`; `collideShip` — gracz, P2, NPC `24245–24256`;
`rig` — tryb wydobycia, klawisze, mysz, krok `9320`, `15825–15877`, `24270–24291`, `24648–24713`; fabuła
`beltDensity`, `beltGiants` `28461–28462`), UI (radar `env.belt`, nakładka wydobycia). Dane: co klatkę prawie nic
(7 id statków ze światłami); jednorazowo SDF olbrzymów ~52 MB (`new Uint8Array`, `asteroidGiants.js:715` — do SAB,
czyta je kolizja i tekstura 3D), cień pól ~12 MB (albo worker liczy sam), mapy promienia 640 KB; przy wydobyciu ≤ 40
ciał, ≤ 500 okruchów, delty komórek 1–3 KB. DOM: `beltMedium.js:57–58` (`innerWidth`, `screen`), `new Worker`
i `hardwareConcurrency` (`asteroidGiantBuilder.js:14`, `24`).

**Ring „Halo” i K-7** (`src/3d/haloRing/haloRingGame.js`): `update(dt, cam, {sun, ship, gameDt, quality, splitScreen})`
(`index.html:26134`, co klatkę, także w pauzie), `_ensureRing` leniwie, gdy środek kadru < 420 tys. j. albo z menu.
Czyta: kamerę (`x, y, zoom`; w free3d `Core3D.cameraPersp`), surowy `ship` (`dead, pos, w`; przez `hubOutline`
`angle, h, radius`; automat stanowisk `vel, angVel, destroyed`), `planet.x/y`, `SUN`, `OPTIONS.planetQuality`.
Użycia w `index.html`: rozgrywka (`pointInSlab` dla pocisków `21848`; `constrainShip` gracza `24867`, P2 `24874`, NPC
`24910` z bramką na `entries[].collider.floorMid`), fabuła (`k7HallPoses` → rejestr kolidera `28449`; `k7Hall` →
OBIEKT 3D hali, w którym fabuła pisze `berth.occupied / reserved` i woła `hall.setBerthLamps()`, `storyGame.js:454–463`),
obraz (`entries`, `clock` dla pyłu hal, `hallRoofOverride` `28441`), menu (`gameSunLocal`, `showcaseHallCut`, tło),
radar (`env.rings` → `wallItems`). Dane na klatkę ~1,3 KB (kamera, gracz, planety, zegary, nadpisanie dachu, pozy
3 × 16 stanowisk × 6 f32, lampki). Sam obraz: fizyka przewodów paliwowych `stepK7FuelRig` (~0,57 ms/klatkę przy
8 przewodach, czyta obrys kadłuba), zanik dachu, wycięcia ściany. DOM: `haloPortK7.js:583` (`document` pod `typeof` —
w workerze napisy K-7 znikną bez błędu), `arch/ecumene.js:240`, `297`, `arch/fable.js:243`, `246`, `446` (kanwy bez
osłony — ringi Marsa i Jowisza się nie zbudują bez `OffscreenCanvas`).

**Suchy dok i ciała świata** (`src/3d/pirateDryDockGame.js`, `src/3d/worldBodies3D.js`): `updatePirateDryDock3D(dt,
storyDryDockFrameState())` (`index.html:26159`; stan klatki: `alarmed, alarmAt, parkedList[].__dockBerth /
__storyLaunched, slipList[].__slip, SUN`), `syncWorldBodies3D()` (`26161`; czyta `worldBodies.sites`, `window.wrecks`,
`piece.state / touched`, `hull.*`, `body.activeNodes / _maxDisp`, węzły — skóra `writeHullSkinField`; pisze tylko stan
obrazu `piece.__skin*`, `__staticHidden`, `body/hull.__skin3D`), zdarzenia break / ram (`28129`, `28158`, `28213`,
`28279`), raz na misję `attachPirateDryDock3D` / `attachPirateDryDockBodies`. Moduły gry doku są czyste
(`worldBodies.js`, `worldChannels.js`, `pirateDryDockBodies.js`, `shipyardLayout.js`; scena doku to dane z
`buildPirateDryDockScene`, bez three). Dane: bez zdarzeń ~80 B/klatkę; taran ~7–17 KB; łańcuch rozpadu 27–90 KB na
klatkę (sufit ~255 KB, ~7 tys. odłamków po ~40 B); geometria skór (~110 MB) zostaje w workerze. DOM:
`portBuildings3D.js:160` (kanwa napisów), `portHullBuild3D.js:39–40` (`new Image`).

**Warp „Nurt”** (`src/3d/warp/warpNurt.js`): `WarpNurt.update(_warpNurtFrame(PAUSED ? 0 : frameDt, camNoShake, cam))`
(`index.html:26118`; kontekst `cam, camShake, camFollow, ship, warp, npcs` — bez filtra mgły wojny, `lensAllowed`);
API zdarzeń `planArrival`, `attach`, `arrive / arriveAll`, `depart` (`callInSupport`, tryb LINIE, `supportWarp.js`).
Czyta: `warp.{state, charge, chargeTime, gear, dir, flybyFactor, cruise, speed, exitRamp.*}`, `warp.targetBody`
(REFERENCJA planety — w workerze indeks), gracza (`window.__interpShipPose`, wymiary z `beamHull` / `visual`), NPC
(`state === 'warping_in'` — skan wszystkich co klatkę, `warpData.speed`, `x/y/vx/vy`). Czyste już dziś: `arrivals.js`
(`planWarpArrivalFx`, `arrivalFxPose`, `departFxPose`) i `player.js`. Dane: warp gracza ~50 B/klatkę, zdarzenia 10–60 B.

**Pył kosmiczny, `EngineFrame`, planety** — sam obraz. `SpaceDust3D.frame` (`index.html:26124`) czyta kamery, hak
passa, `WARP_STARS.stretch`, `EngineFrame` (dysze MAIN tej klatki — pisze `EngineVfxSystem` w `updateHexShips3D`;
czytają tylko moduły 3D). `initPlanets3D(planets, SUN)` (raz), `setSkyZone`, `updatePlanets3D(frameDt, camNoShake)`
(`frameDt` niezerowane w pauzie); pozycje planet liczy gra (orbity w `index.html:23115–23123`; w trybie Układu
Słonecznego stoją), księżyce 3D to dekoracja. Moduł czyta `window.planets`, `window.SUN`, `window.ship`, pisze
`window.EARTH` (czyta go tło menu i `devTools.js`), a jego `window.worldToScreen` (`:1264`) to martwy kod (nadpisuje
`index.html:25214`, `25286`). `worldToScreen` / `worldToScreenInto` / `screenToWorld` są CZYSTE (kamera gry, viewport,
`View3D`) i zostają na wątku głównym — pod warunkiem, że worker rysuje dokładnie kamerę z migawki tej klatki.

**Tło menu** (`src/3d/menuBackdrop3D.js`): własna pętla rAF; gra → tło `setActive, setFocus, setPointer, launch, fly,
stop`; tło → gra SYNCHRONICZNIE: `onReady` (klasa CSS), getter `launchDone` odpytywany przy starcie (`index.html:28758`),
`cameraPose()`, `sunLocal`, Promise `fly` rozwiązywany w klatce renderu, `onFinish(canvas)` → `captureStorySnapshot`
rysuje kanwę WebGPU na 2D. `StoryGame.planMenuIntro` zwraca domknięcia — do workera trzeba wysłać dane (klucze lotu
dla czystego `sampleKeys`, słońca, progi).

**Pył hal K-7** (§ 3.7) — do poprawy przed workerem: trzy przecieki renderu przez grę (`clock` z `performance.now()`
w `HaloRingGame` `:282`, `lamps` pisane przez render do rejestru gry `:419` i pakowane z powrotem, pozy kroczone
w renderze `:367`); przy SAB „wygrywa ostatnia migawka”, więc pominięta migawka gubi swoje `dt` (lepiej monotoniczny
czas gry); maski obrysu (8 KB z 10,5 KB) tylko przy zmianie; strażnik `tests/hallDust.test.mjs:300–310` nie sprawdza
importów przechodnich (`engineFrame.js:150`, `fxRandom.js:84` piszą do `window`); pola `sunX/sunY` martwe.

### 2.4 Zmienne gry z `window.*` czytane w renderze

**43 nazwy, 164 odczyty** w modułach renderu ładowanych przez grę (37 zmiennych pisze tylko gra, 3 — gra i render:
`DevConfig`, `worldToScreen`, `Dev`; 3 to haki dev, których nikt nie pisze: `ENGINE_POINT_LIGHTS_ENABLED`,
`stationScaleById`, `stationPivotById`). **33 nazwy / 134 odczyty** w modułach, które przejdą do workera; 10 nazw
czytają wyłącznie moduły kanwy 2D (`canvasParticleSystem.js`, `turret2D.js`, `collisionSparks.js`), które zostają.
Poza tym render czyta 11 własnych globali (strojenia `__*Tune`, `__weapon3dCameraShake`…) i 4 przeglądarki
(`innerWidth`, `innerHeight`, `screen`, `devicePixelRatio`), a `GameState` — 9 razy (`engineVfxSystem.js`: `ship`,
`warp`, `boost`, `ramBurn`; `warpNurt.js`: `warp`, `ship`). Część zmiennych to FUNKCJE ROZGRYWKI wołane przez render:
`applyDamageToNPC`, `applyDamageToPlayer`, `applyRocketHullImpact`, `registerShieldImpact`, `isShieldBreachedAt`,
`applyDamageToStation`, `Game`, `WorldBodies` — wszystkie z `rocketSystem3D.js`, czyli z rozgrywki rakiet w katalogu
renderu (RW-23).

| zmienna | odczytów | moduły renderu (odczyt) | pisze | uwagi |
|---|---|---|---|---|
| `SUN` | 26 | 3d/bridge3D.js, 3d/core3d.js, 3d/explosions/explosionFx.js, 3d/hexShips3D.js, 3d/hullDebris3D.js, 3d/planet3d.assets.js, 3d/rockets/rocketFx.js | index.html:6740 | HEAD (stałe) |
| `ship` | 15 | 3d/engineVfxSystem.js, 3d/hexShips3D.js, 3d/planet3d.assets.js, 3d/rockets/effects.js, 3d/shield3D.js, 3d/weapons/weaponFx.js, effects3d/rocketSystem3D.js, vfx/canvasParticleSystem.js, vfx/turret2D.js | index.html:4469 | lustro gracza |
| `DevTuning` | 12 | 3d/hexShips3D.js, 3d/stations3D.js, vfx/turret2D.js | index.html:2648, src/ui/devTools.js:400 |  |
| `DevVFX` | 8 | 3d/core3d.js, 3d/planet3d.assets.js | src/ui/bloomTunerPanel.js:49, src/ui/bloomTunerPanel.js:106 |  |
| `splitScreenMode` | 7 | 3d/asteroids/asteroidBelt.js, 3d/cloak/hullCloak.js, 3d/core3d.js, 3d/hexShips3D.js, 3d/planet3d.assets.js | index.html:24919, index.html:29087 | HEAD |
| `camera` | 7 | 3d/hexShips3D.js, 3d/hullDebris3D.js, 3d/rockets/effects.js, 3d/weapons/weaponFx.js, vfx/canvasParticleSystem.js | index.html:25211 | HEAD |
| `__interpShipPose` | 5 | 3d/engineVfxSystem.js, 3d/hexShips3D.js, 3d/rockets/effects.js, 3d/warp/warpNurt.js | index.html:25945 | ENT (poza gracza) |
| `OPTIONS` | 5 | 3d/engineVfxSystem.js, 3d/menuBackdrop3D.js | index.html:2009 | rozkaz opcji |
| `W` | 5 | vfx/canvasParticleSystem.js | index.html:1459, index.html:6296 | tylko moduły kanwy 2D (zostają w grze) |
| `H` | 5 | vfx/canvasParticleSystem.js | index.html:1459, index.html:6296 | tylko moduły kanwy 2D (zostają w grze) |
| `camera2` | 4 | 3d/asteroids/asteroidBelt.js, 3d/core3d.js | index.html:29359 | HEAD |
| `Destruction3D` | 4 | 3d/world3d.js | index.html#most:797 | moduł renderu wystawiony przez most — zostaje w workerze |
| `__renderDbgRecord` | 3 | 3d/core3d.js | src/ui/liveDebug.js:42, src/ui/liveDebug.js:53 |  |
| `planets` | 3 | 3d/planet3d.assets.js | index.html:6878 | init + WORLD |
| `VFX_TUNE` | 2 | 3d/engineVfxSystem.js | index.html:2023, index.html:2039 |  |
| `bullets` | 2 | 3d/hexShips3D.js | index.html:1401 | blok SHOTS |
| `HullBodies` | 2 | 3d/rockets/effects.js, 3d/weapons/weaponFx.js | src/game/hullBodies.js:2347 | silnik belek — w workerze lustra (§ 3.6) |
| `player2Ship` | 2 | 3d/weapons/weaponFx.js | index.html:29358 |  |
| `wrecks` | 2 | 3d/worldBodies3D.js | index.html:7449 | blok LISTS |
| `isShieldBreachedAt` | 2 | effects3d/rocketSystem3D.js | index.html:1062 | rozgrywka rakiet → gra (RW-23) |
| `registerShieldImpact` | 2 | effects3d/rocketSystem3D.js | index.html:1406 | rozgrywka rakiet → gra (RW-23) |
| `applyRocketHullImpact` | 2 | effects3d/rocketSystem3D.js | index.html:9479 | rozgrywka rakiet → gra (RW-23) |
| `applyDamageToNPC` | 2 | effects3d/rocketSystem3D.js | index.html:21003 | rozgrywka rakiet → gra (RW-23) |
| `applyDamageToPlayer` | 2 | effects3d/rocketSystem3D.js | index.html:20677 | rozgrywka rakiet → gra (RW-23) |
| `npcs` | 2 | effects3d/rocketSystem3D.js | index.html:7445, index.html:10899 | rozgrywka rakiet → gra (RW-23) |
| `SparkSystem3D` | 2 | vfx/collisionSparks.js | index.html:1178 | tylko moduły kanwy 2D (zostają w grze) |
| `__interpShipTurretAngles` | 2 | vfx/turret2D.js | index.html:25946 | tylko moduły kanwy 2D (zostają w grze) |
| `__weaponAimAlpha` | 2 | vfx/turret2D.js | index.html:25929 | tylko moduły kanwy 2D (zostają w grze) |
| `shipDriveState` | 1 | 3d/engineVfxSystem.js | index.html:14845 |  |
| `warp` | 1 | 3d/hullLacquer.js | index.html:22545 |  |
| `Game` | 1 | effects3d/rocketSystem3D.js | index.html:4409 | rozgrywka rakiet → gra (RW-23) |
| `WorldBodies` | 1 | effects3d/rocketSystem3D.js | src/game/worldBodies.js:735 | rozgrywka rakiet → gra (RW-23) |
| `applyDamageToStation` | 1 | effects3d/rocketSystem3D.js | index.html:21171 | rozgrywka rakiet → gra (RW-23) |
| `worldToScreenInto` | 1 | vfx/canvasParticleSystem.js | index.html:25281 | tylko moduły kanwy 2D (zostają w grze) |
| `CANVAS_WEAPON_VFX_ENABLED` | 1 | vfx/canvasParticleSystem.js | index.html:10969 | tylko moduły kanwy 2D (zostają w grze) |
| `PHYS_HZ` | 1 | vfx/collisionSparks.js | index.html:24946 | tylko moduły kanwy 2D (zostają w grze) |
| `CICDisplay` | 1 | vfx/turret2D.js | src/ui/cicDisplay.js:2549 | tylko moduły kanwy 2D (zostają w grze) |
| `DevConfig` | 8 | 3d/stations3D.js | src/ui/devTools.js:392, src/3d/stations3D.js:605 |  |
| `worldToScreen` | 5 | vfx/canvasParticleSystem.js, vfx/turret2D.js | index.html:25214, index.html:25286 | tylko moduły kanwy 2D (zostają w grze) |
| `Dev` | 2 | 3d/planet3d.assets.js, 3d/stations3D.js | index.html:2656, src/ui/devTools.js:395 |  |
| `ENGINE_POINT_LIGHTS_ENABLED` | 1 | 3d/engineExhaustBatch.js | — (hak dev) |  |
| `stationScaleById` | 1 | 3d/stations3D.js | — (hak dev) |  |
| `stationPivotById` | 1 | 3d/stations3D.js | — (hak dev) |  |

### 2.5 Zdarzenia efektów: kto, skąd, jak często

Rytmy źródeł: (1) `physicsStep` 120 Hz — strzały, trafienia, PD, przebicia, kolizje, odłamki węzłów, reaktor, ładowanie;
(2) pętla rAF poza fizyką — lot rakiet `rocketSystem3D.update(frame)` (`index.html:25198`) i Hexlance
`updateSuperweapon(frame)` (`index.html:25145`); (3) `render()` — `WeaponFx.sync`, rdzenie reaktorów; (4) UI — salwa
torped (handler LPM, `index.html:24475`). Każde wejście do efektów to dziś synchroniczne wywołanie z NIEJAWNYM stanem
globalnym, który rekord musi nieść jawnie: nośnik `ActiveCarrier` (`src/game/carrierVelocity.js:117`), `SimClock`
(`src/game/simClock.js:25`), `fxRandom` (`src/3d/fx/fxRandom.js:81`), `WeaponFx.shotShakeScale` (`index.html:10314`,
`19895`), `HullDamageMap.setSource/clearSource` (`index.html:9458`). Szacunek wolumenu (kadencje z `src/data/weapons.js`,
nie pomiar): zwykła bitwa ~4–10 tys. rekordów/s, czyli ~70–170 na klatkę po ~64 B — ≤ 11 KB/klatkę. Liczniki do
pomiaru już są: `WeaponFx.stats` (`weaponFx.js:226`), `CollisionFX.stats` (`collisionFx.js:128`),
`__rocketFx.director.stats`.

**Broń — `WeaponShotBus` i `WeaponFx`** (`src/game/weaponShotBus.js`, `src/3d/weapons/weaponFx.js`):

| wejście | parametry (i co receptura czyta później) | wołający (krok) | częstość (szac.) | wynik w grze | żywa encja w efekcie |
|---|---|---|---|---|---|
| `WeaponShotBus.emit` → `_onShot` (wylot, `weaponFx.js:451–501`) | `weaponId, shooter, x, y, dirX, dirY, isBeam, beamMode, beam{start, end, width, kind, emitterUid, hitEntity, nx, ny}`; `Turret2D.triggerShot` MUTUJE odrzut wieży i zwraca lufę (`:480`), `muzzleZOf` (`:486`), wstrząs `+= shot.shake · shotShakeScale` (`:490`) | `fireWeaponCore` (`index.html:9863`, emit `:10187`) z kierowania ogniem, specjali, P2, NPC; salwa torped z UI | ~300–500/s (szczyty PD ~1000/s); wiązka ciągła 20 Hz na emiter | nie | lufa z rekordów `Turret2D` poprzedniej klatki |
| wiązka ciągła (`weaponFx.js:569–603`) | stan po `emitterUid` (napis) | szyna, krok | dziesiątki–setki/s | nie | **tak** — `shooter` i `hitEntity` do 0,55 s; co klatkę `writeCarrier` (`:735–737`) i `Turret2D.resolveMuzzleSlot` (`:707`) |
| impuls / laser PD (`_firePulse :634`, `pdLaser :669`) | `sx…ey, width, hitEntity, nx, ny` | szyna, `ciwsStep` (`index.html:20437`, `20501`) | ~5,5/s na laser | nie | **tak** — `hitEntity` do dojścia frontu (`:747–758`) |
| `pdShot` (`:531`) | jak wylot | CIWS `20482`, flak `20553` | ~17–20/s na CIWS | nie | — |
| `impact(b, x, y, scale, hit)` (`:780`) | z pocisku: `__fx, z, vx, vy, ivx, ivy, owner, vfxKey, type, weaponSize, flakBurstRadius`; z `hit` (`writeImpactHit`): `nx, ny, relVx, relVy, entity, kind, through, ric*`; wstrząs: `window.ship` / `player2Ship` | `spawnBulletImpactEffect` (`index.html:11160`; bramki ekranu i cooldownu na kamerze gry) ← pętla pocisków, CIWS, laser PD, flak | ~100–250/s po bramkach (bogatych ≤ 48/klatkę) | nie | **tak, przez kadłub:** `ctx.burn(hull)` (wyrwa żyje 1,6–3,5 s, czyta `pos, angle, removed, __cloakLook`, `:393–419`), `ctx.after(…, hull)` do 0,49 s, `ctx.stamp(hull)`, `ctx.hullInside` → `HullBodies.probe` (`:332–336`) |
| `kerf`, `pierceExit`, `pierceStuck` (`:864`, `:888`, `:893`) | `vfxKey/type, weaponSize, owner`, punkt, kierunek, prędkość względna | `applyBulletHullPass` (`index.html:11130–11133`) | 0–20/s | nie | tylko do stempla |
| `flakBurst` (`:940`), `droneBlast` (`:955`) | punkt, promień / rozmiar (`window.ship.h · 0,18`) | `detonateFlakShell` `20630`; `CanvasVFX._spawnDeathBlast3D` (śmierć NPC) | dziesiątki/s; 1–5/s | nie | — |
| `charge(…, state, C)` (`:1065`), `createChargeState()` | stan `{arcT}` TRZYMANY W OBIEKCIE GRY (`st.fx`, `weapon.chargeFx`) | `stepSpecialCharge` (`index.html:10263`), P2 (`weaponController.js:477`) | 120/s na ładujące działo | nie | — |
| `hexlance*` (`:967–1058`) | punkt, kierunek, prędkość, moc, wstrząs, nośnik jawnie | `src/game/superweapon.js` (rAF) | `Step` 1/klatkę na pocisk | **tak** — `hexlanceBegin` zwraca uchwyt `proj.slug`; bez niego gra rysuje smugę na kanwie (`superweapon.js:571`) | — |
| `sync(bullets)` (`:1084`) | czyta `life, x, y, forceCanvas, __fx, vx, vy, vz, z, clock, age`; przy inicjacji `ivx, ivy, ivz, vfxKey, type, weaponSize, source`; PISZE `b.__fx`, `b.__renderedByThree` (czytane przez rozgrywkę jako `threeVisual` w pętli pocisków — pomija smugi kanwy), torpedy `b.__wakeAcc` | `updateHexShips3D` (`hexShips3D.js:2294`) | ≤ 150–300 pocisków/klatkę | **tak** (flagi w pocisku) | `b.source` przy inicjacji |
| `available` | gałęzie zapasowe gry (`index.html:10260`, `10522`, `11127`, `11161`, `21274`; `superweapon.js`, `weaponController.js:473`, `canvasParticleSystem.js:215`) | — | — | **tak** | — |
| `__weapon3dCameraShake` | `{mag}` pisane w `sync` (`:1252–1260`), czytane przez `render()` następnej klatki (`index.html:26047`) — już dziś klatka opóźnienia | — | 1/klatkę | **tak** (kamera gry) | — |

Nie wszystkie pociski mają `serial` (CIWS `index.html:20461`, rakiety kanwy `19442`, NPC `21984`) — migawka
potrzebuje stałego id pocisku.

**Rakiety.** `src/effects3d/rocketSystem3D.js` to ROZGRYWKA bez obiektów sceny (pula 2000 slotów; three tylko
jako matematyka `Vector3` / `Quaternion`, `scene` przechowywane i nieużywane, `:288–289`): wyrzut i salwy
(`fire` `:470`, `fireSalvo` `:650`; pierwsza rakieta salwy startuje w `physicsStep` z `fireWeaponCore`, reszta
w `update`), lot, naprowadzanie, zapalnik i zasięg w `update` (`:804–1156`) — **w rAF z dt klatki** (≤ 0,033 s), nie
w kroku 120 Hz; obrażenia `_onHit` (`:1208–1254`: `isShieldBreachedAt` — ze stanu GPU, `registerShieldImpact`,
`applyRocketHullImpact`, `applyDamageToPlayer/NPC`, `window.Game`), wybuch obszarowy (`window.npcs`, `window.ship`,
`WorldBodies.detonateDamage`, `applyDamageToStation`), haki kierowania ogniem (`retarget`, `collectIncoming`,
`planNextSalvo`). Obraz to reżyser `RocketEffects` (`src/3d/rockets/effects.js`) na zdarzeniach `beginUpdate`,
`onLaunch` (+ `Turret2D.triggerShot`, `:421`), `onIgnite`, `onFly` (na rakietę na klatkę — w workerze z bloku
ROCKETS, bez rekordu), `onSplit`, `prepareContact` (zapytanie `rocketHullContact(HullBodies)`, `:779–781`),
`onDetonate` (przypalenie trzyma trafioną encję 3,2 s), `update`, `torpedoWake` (z pętli pocisków,
`index.html:21427`); krok Core3D „rakiety” (`rocketFx.js`) co klatkę czyta całą pulę rakiet i `window.SUN`.
`rocketSystem3D.rockets` czytają: radar (`index.html:5567` → `radarFeed.js:275–295`), kierowanie ogniem
(`fcMissileIncoming` `19921`, `fcRocketRetarget` `20128`) i reżyser efektów.

**Wybuchy** `window.makeReactorBlow({x, y, size, profile, vx, vy})` (fabryka `index.html:1496`): kawałek doku
pęka (`index.html:28133`, krok; łańcuch 13 wybuchów w 3,4 s), `triggerReactorBlow3D` (śmierć gracza bez rdzenia,
`6333`), fabuła `api.reactorBlow` (`storyGame.js:911`, `929`, `944`; rAF), `Destruction3D` wewnątrz renderu.
Wynik (bool) nieużywany. Zegar wybuchu `SimClock.sim`.

**Iskry, kolizje, odłamki.** `CollisionFX` (`src/vfx/collisionFx.js`) to SZYNA ROZGRYWKI: `onGrind` na parę
w styku na krok (0–3600/s; `hullBodies.js:2166`), `onImpact` (cooldown 1,5 s na parę; taran statyki
`index.html:28229`); subskrybenci: iskry (`collisionSparks.js:125`) i rozgrywka (zerwanie maskowania
`index.html:6060–6061`, taran doku `28175–28176`). Budżet iskier tarcia (`grindSparkBudget`, WeakMap par, `fxRandom`)
liczy się w subskrybencie — do strumienia tylko gotowe paczki. `spawnHullDebris` (`hullBodies.js:2180–2193`, global
`window`, losuje `scale` i `structural` z `fxRandom` PO STRONIE GRY) — dziesiątki–setki/s, łańcuch doku ~1750/s.
`CanvasVFX.*` zostaje w grze (kanwa 2D), poza `_spawnDeathBlast3D` → `WeaponFx.droneBlast`.

**Reaktor** (`ReactorGame` w `physicsStep` → `reactorBlastFx`): `detonation(ev, res, hits)` (`reactorCoreGame.js:290`;
`res.cuts`, `edges` z ENCJAMI odłamów, `fragments` + `HullBodies.probe`), `addJet` / `addOrb` — ŻYWE obiekty
logiki czytane co klatkę w `syncHazards` (`reactorBlastFx.js:819–938`), `melt`, `jetCut` (→ `HullDamageMap.stampKerf`),
`orbBurst`, `secondary`, `onShake` (→ `camera.addShake`, `index.html:1506`); w `render()` `syncCores` czyta z logiki
`host, state, gridR, meltdownRemaining/Duration, deadCount, cellX, cellState` i woła `HullBodies.probe` (`:451`).

**Światła, zniekształcenia, gorące powietrze z gry: brak** — `Core3D.fx.lights`, `fxDistortion()`,
`pushHeatHazeWorld` występują wyłącznie w `src/3d` (grep po `index.html`, `src/game`, `src/ai`, `src/ui`, `src/vfx`,
`src/effects3d`: 0 trafień). Za to render woła `camera.addShake` gry: receptury (`weaponFx.js:323–330`, czyta
`cam.shakeMag/Time/Dur`), supernowa (`effects.js:1020–1026`), `reactorBlastFx.onShake` (`index.html:1506`),
`WarpNurt.onShake` (`index.html:25912`).

**Render pyta silnik belek synchronicznie:** `HullBodies.probe` (`recipes.js:207` przez `weaponFx.js:332`;
`reactorBlastFx.js:451`, `642`), `HullBodies.spriteUvAt` (`hullDamageMap.js:448`, `523`, `539`), `rocketHullContact`
(`effects.js:781`). W workerze: wynik w rekordzie (uv i punkt styku liczy już gra — `HullBodies` ma `r.u / r.v`)
albo lustro obrysu w migawce (wzór: maska bitowa żywych węzłów `hullFootprint` pyłu hal).

**`fxRandom` to jeden ciąg dla gry i renderu** (`window.fxRandom`): gra losuje wysokość tonu dźwięku strzału
(`index.html:2197` — słuchacz szyny zarejestrowany PRZED `WeaponFx`), parametry odłamków węzłów
(`hullBodies.js:2191–2192`), pary iskier (`collisionSparks.js:66`), cząstki kanwy (`index.html:19457–19549`,
`21300–21306`, `superweapon.js`); render — receptury, smugi (`trails.js:254–257`), reżyser rakiet, wybuchy, reaktor,
iskry. Harness ustawia ziarno tylko `window.fxRandom` (`harness-strona.js:630`).

### 2.6 Rozgrywka w modułach 3D i odczyty GPU → CPU

Worker nie odpowie synchronicznie, więc każdy wynik renderu, od którego dziś zależy rozgrywka albo rysunek kanwy 2D
tej samej klatki, musi dostać nowe miejsce. Rozgrywka siedzi w 5 z 8 modułów świata i w kilku efektach:

| # | co | gdzie dziś | kto zależy | docelowo (zadanie) |
|---|---|---|---|---|
| 1 | **przebicie tarcz** — mapa dziur liczona na GPU (pole energii, przegrzanie B, płytki odpadają przy B > 0,45–0,7, `shieldPool.js:391–400`); odczyt `getArrayBufferAsync` co 0,1 s (6 KB, `shield3D.js:641–670`) → `encja.__shieldBreach`; `isShieldBreachedAt` czyta stan RENDERU (sloty, siatka płytek, poza z ostatniej klatki, `:680–701`) | `src/3d/shield3D.js` | pociski (`index.html:21613`, 120 Hz), wiązki (`9643`), rakiety (`rocketSystem3D.js:1219`) | bity przebić w `RET`, test punktu po stronie gry (siatka płytek deterministyczna — `acquireShieldLattice(profile, 4096)`); dziś opóźnienie 0,10–0,15 s, po podziale +≤ 1 klatka (RW-29). **Slot dostaje tylko tarcza na ekranie, nieukryta mgłą, ≥ 9 px — przebicie już dziś zależy od kamery, mgły i DPR** (decyzja D3) |
| 2 | **rakiety** — lot, naprowadzanie, zapalnik, obrażenia w `src/effects3d/rocketSystem3D.js` (bez obiektów sceny), krok w rAF z dt klatki | `rocketSystem3D` | radar, kierowanie ogniem, obrażenia | `src/game/rockets/` + rekordy `RKT_*` i blok ROCKETS (RW-23); decyzja D2 — krok 120 Hz |
| 3 | **pas: wydobycie** powstaje w `initGpu` po odczycie banku skał z GPU (`rockBank.js:671`, 655 KB map promienia → masa, ruda, raycast, zderzenia ciał skał; bez GPU „platforma niegotowa”, `index.html:9320`); port na CPU ryzykowny (hasz kształtu we float32, `rockBank.js:328–331`) | `asteroidBelt.js:211–301` | tryb wydobycia, ładownia | gra tworzy `AsteroidMining` / `MiningRig` po zdarzeniu `bankRadius` z workera (raz) (RW-25) |
| 4 | **pas: olbrzymy** — budowę SDF zleca TYLKO krok renderu (`giants.requestNear`, `asteroidBelt.js:690–691`), i tylko gdy kadr dotyka pasa; bez tego `readyCount = 0`: kolizje statków wychodzą (`index.html:24247`), pociski przelatują | `asteroidBelt.js` | kolizje, pociski | zlecanie po stronie gry (kamera i statek), SDF w SAB (RW-25) |
| 5 | **pas: zegar skał** `this.time += dt` w kroku efektów (`:531`) to `timeSource` platformy (faza obrotu przejmowanej skały); wspólny `Set` `playLayer.hidden = rig.taken`; wspólny cache pola (`field.endFrame`); `minedRocks.js:582` zeruje `body.dirtyBox` ciała gry; `playZ` z `MINERAL_TYPES` modułu renderu | `asteroidBelt.js`, `minedRocks.js` | wydobycie | czas gry, własne cięcie cache i konsument delt po stronie gry (RW-25) |
| 6 | **ring: kolidery** `HaloRingCollider` (czysty) mieszkają w `entries` klasy 3D; `constrainShip`, `pointInSlab` to jej metody (`haloRingGame.js:85–108`, `461–480`) | `haloRingGame.js` | kolizje statków i pocisków, pył hal, radar | `src/game/haloRingWorld.js` o tym samym kształcie `entries` (RW-27) |
| 7 | **ring: teren** — `setTerrain(ring.terrainHeightAt)` dopiero po `ring.ready`, a ring powstaje tylko przy kamerze — do tego czasu płyta kolizji jest PŁASKA; Ziemia: odczyt mapy świata (`haloRingWorldGen.js:744`, 2048 × 96 RGBA32F ≈ 3 MB → 786 KB wysokości), dwa razy (init i `setCivic`) i przy zmianie jakości; kolider pyta tylko o z = 0 — rozgrywce wystarczy 16 KB | `haloRingGame.js:160–170` | kolizje z terenem | Mars i Jowisz z czystych planów CPU (`ecumenePlan.js`, `fablePlan.js`) od razu; Ziemia: profil z = 0 z workera (`postMessage`) albo wypieczony offline (RW-27) |
| 8 | **ring: automat stanowisk K-7** krokowany w renderze (`:367`) tylko dla ringu zbudowanego i w kadrze, nigdy w podzielonym ekranie — pozy (stan gry) zależą od widoczności; zajętość stanowisk w obiektach hali 3D (fabuła pisze `berth.occupied / reserved`, `storyGame.js:454–463`); zegar migania z `performance.now()` (`:282`) płynie przez grę do pyłu hal, render pisze `owner.lampLevel` do rejestru gry (`:419`) | `haloRingGame.js` | pył hal, fabuła, lampki | automat na wątku głównym w czasie gry, bez bramki widoczności; zajętość i zegar w migawce (RW-27) |
| 9 | **dok: stan kawałków** `chunkState {broken, hidden…}` (`pirateDryDock3D.js:56–61`); zbiór `station._dockGone` przebudowuje TYLKO render (`syncGone`, `pirateDryDockGame.js:179–184`) — czytają go wiązki (`index.html:9667`), pociski (`21913`), taran (`28201`), Hexlance (`superweapon.js:498`), radar; spóźnia się ≤ 1 klatkę, w mgle stoi; `pirateDryDockBrokenChunks()` decyduje o planie łańcucha i o tym, które okręty z parkingu giną; WYNIK `breakPirateDryDockChunk` / `ramPirateDryDockChunk` steruje grą (próg punktów, iskry, hamowanie, `gateRammed`) | `src/3d/pirateDryDockGame.js` | punkty i łańcuch doku, taran, broń, fabuła | czysty moduł gry (stan kawałków, `gone`, `live`, decyzje break / ram) zaraz po `worldBodies.step`; 3D dostaje zdarzenia, dryf odpadłych kawałków zostaje w 3D (RW-24) |
| 10 | **dok: ciała świata tworzy moduł 3D** — `createPirateDryDockSite(entity, dock, …)` dostaje OBIEKT 3D (`dock.layout / scene / style`, `available()` → `dock.isChunkGone`); haki `onLive / onLost` → `dock.hideChunk`; prebuild kratownic w rozgrzewce 3D (wymaga `Core3D.scene`) | `pirateDryDockGame.js:52–61`, `142–174` | ciała świata (taran, broń) | `spawnStoryPirateDryDock` i ekran ładowania na danych z czystego `buildPirateDryDockScene` (RW-24) |
| 11 | **warp: zegar efektu** `WarpNurt.time` (biegnie z klatką rAF, `warpNurt.js:202–203`; w scenach fabuły nie stoi) decyduje o chwili pojawienia się wezwań (`supportWarp.js:66`, `73–76`), fazach POWROTU (`:161–195`) i ETA (`index.html:8570`) | `src/3d/warp/warpNurt.js` | spawn wsparcia, POWRÓT, fabuła | `SimClock.sim` / czas gry (RW-28) |
| 12 | **warp: efekt PROWADZI okręty** — pisze `isCollidable`, `x/y/vx/vy`, `pos/vel`, `angle/desiredAngle/angVel` (`warpNurt.js:830–846`, `899–911`), odlot z `drive`; `onGone` → `dematerializeSupportUnit` (`index.html:8642–8654`, też ucieczka herszta); pula 24 przylotów — pełna = spawn od razu, tempo fal fabuły zależy od `warpArrivalsFree` (`storyGame.js:651`); wykrywanie `warping_in` skanem `npcs` | `warpNurt.js` | ruch i kolizje okrętów, fabuła | rejestr przylotów i odlotów w grze (`src/game/warpTraffic.js`), poza z czystych `arrivalFxPose` / `departFxPose` w kroku fizyki; worker dostaje rekordy `WARP_*` (RW-28) |
| 13 | **maskowanie** — `updateCloakLooks` (`hexShips3D.js:2127`) pisze `e.__cloakLook` | `src/3d/cloak/hullCloak.js` | `Turret2D.draw` (kanwa), `cloakLightGain` (mostki), receptury | liczone po stronie gry (`cloakLook.js` jest czysty), w ENT (RW-26) |
| 14 | **wieżyczki** — rekordy `Turret2D.sync` powstają w `updateHexShips3D` (tylko kadr), odrzut podbijają `WeaponFx` i reżyser rakiet (`triggerShot` szuka wieży po najbliższym wylocie), `lightAt` ← `Core3D.sunVisibilityAtWorld` (dyski cienia planet zgłaszane w `updatePlanets3D` × pole pasa `sunFieldCpu`) | `src/vfx/turret2D.js` + render | kanwa 2D, lufy `WeaponFx`, modele 3D, wysokości pocisków | `sync` i odrzut po stronie gry (`sync` czyta wyłącznie dane gry; gniazdo strzelca znane w chwili strzału), blok TURRETS; jasność z dysków planet i pola pasa na CPU gry albo z `RET` (RW-26) |
| 15 | **zimne wraki** — `isColdFreezeVisuallySafe` = poza pudłem rysowania OSTATNIEJ klatki albo LOD `batchedImpostor` (< 15 px); `captureColdWreckImpostor` pisze `snapshot.impostor` do obiektu gry | `src/3d/hexShips3D.js:2458–2481` | zamrażanie wraków (dziś tylko heksowych — belkowe czekają na etap 3 portu belek) | reguła w grze (kamera + próg LOD), wypiek impostora rozkazem (RW-31) |
| 16 | **wstrząs kamery** — `__weapon3dCameraShake` (z `WeaponFx.sync`, już dziś klatkę później), `camera.addShake` z receptur, supernowej, `reactorBlastFx.onShake`, `WarpNurt.onShake` (`player.js:170`, `217`, `347`) | render | kamera gry | w grze: z danych broni (`weaponFeel.js`), przejść warpa i zdarzeń (RW-30) |
| 17 | **flagi w obiektach gry** — `b.__renderedByThree` (pętla pocisków pomija smugi kanwy), `proj.slug` Hexlance, stan ładowania `st.fx`, `station._mesh3d` (warunek w `applyDamageToStation`), `WeaponFx.available`, `__warpNurtMode` / `__warpHullU` (render → render przez encję) | render | gałęzie gry | reguły po stronie gry (`!forceCanvas && fxReady`), id zamiast referencji, flaga gotowości w `RET` (RW-21, RW-22) |
| 18 | **tło menu** — start gry czeka na getter `launchDone` i Promise `fly` rozwiązywany w klatce renderu; `onFinish(canvas)` rysuje kanwę WebGPU na 2D | `src/3d/menuBackdrop3D.js` | start gry, kadr sceny fabuły | zdarzenia `RET` (`launchDone{pose, sunLocal}`, `flightDone{ImageBitmap}`), plan lotu jako dane (RW-41) |

**Odczyty GPU → CPU w grafie gry** (skrypt `inwentarz.mjs`, sekcja GPU): rozgrywka — `shield3D.js:669`, `726`
(przebicia, co 0,1 s), `haloRingWorldGen.js:18`, `52`, `744` (mapy ringu, przy budowie), `rockBank.js:671` (bank
skał, raz); narzędzia — `gas/gasGrid.js:835–836` (`probe`), `hullDamageMap.js:155`; poza renderem —
`src/game/destructorGpuSoftBody.js` (solver sprężyn heksów z własnym `GPUDevice`, w grze bez ciał). Odczyty
rozgrywki są jednorazowe albo już asynchroniczne — żaden nie wymaga synchronicznego czekania.

**Zegary renderu czytane przez grę:** `WarpNurt.time`, `asteroidBelt.time`, `HaloRingGame.clock` (z
`performance.now()`), `heatStamp` węzłów (silnik belek pisze go zegarem `performance.now()` wątku głównego —
`destructorBeams3D.js:303` — a render porównuje z własnym `performance.now()`). W workerze `performance.now()` ma
inny `timeOrigin`, więc wszystkie wspólne zegary idą w migawce (§ 3.5).

**Przy okazji (ryzyka dzisiejsze, nie związane z workerem):** zegar warpa biegnie w scenach przy zamrożonym świecie
i przesuwa prowadzone okręty; zegar tarcz biegnie w scenach (`PAUSED ? 0 : frameDt` nie zeruje `worldFrozen`);
`Destruction3D` i `updatePlanets3D` dostają niezerowane `frameDt` w pauzie; obrót stacji `spinOffset += 0.002` na
klatkę bez dt (`stations3D.js:379`); obraz przylotów pomija mgłę wojny (`npcs` bez filtra, `index.html:25905`);
automat stanowisk K-7 stoi w podzielonym ekranie; teren ringu w kolizjach płaski, dopóki kamera nie podejdzie;
`reactor3D.js:299–300` losuje `Math.random()` gry; wieżyczki 2D mogą się rysować na dachu hali doku (nakładki są nad
warstwą FG). Kandydaci na osobne poprawki — lista dla użytkownika, nie część planu.

### 2.7 Rysunki kanwy 2D przyklejone do obiektów świata

**Dziś:** nic z 2D nie leży pod 3D — `render()` czyści `#c` (`index.html:25921`), `drawHexShips3D` czyści ją jeszcze
raz przed kopią (`hexShips3D.js:2368`), więc wszystkie nakładki są NAD całym 3D, łącznie z warstwą FG (dachy hal,
ogień wybuchów, górna ściana ringu). Obie warstwy dostają TEN SAM obiekt kamery `cam` (ze wstrząsem w px): do
`Core3D.syncCamera` przez `updateHexShips3D` i do każdej nakładki — komentarz `index.html:26040–26046` opisuje, że
gdy wstrząs strzałów trafiał tylko do Core3D, „wieżyczki, myśliwce i znaczniki z kanwy 2D stały w miejscu” (rozjazd
kamer warstw był już raz widoczny). Rzut: `worldToScreenInto` (`index.html:25267–25280`; w kamerach 3D
`View3D.project` — czysta matematyka gry, `src/game/view3D.js:126–146`; żadna nakładka nie czyta macierzy z Core3D
ani three). Pozy: gracz interpolowany (`__interpShipPose`, kąty wież), NPC i wraki fizyczne — ta sama reguła po
stronie 3D (`getInterpolatedRenderPose`, `hexShips3D.js:294–301`). `src/ui` i `src/game` nie czytają Core3D poza
statystykami (`perfHud.js`, `devTools.js`, `bloomTunerPanel.js`).

| rysunek | przyklejony do | poza | czyta stan 3D? | tolerancja | liczność (bitwa 166) |
|---|---|---|---|---|---|
| wieżyczki `Turret2D.draw` (`index.html:26747`, `turret2D.js:1134–1275`) | gniazdo na kadłubie | rekordy z `updateHexShips3D` (gracz interp., NPC fiz.; kurs: gracz `mountedWeaponRenderAngle` z `__weaponAimAlpha`, NPC `visualAngle` z AI; odrzut w WeakMap, podbijany przez `WeaponFx` / reżysera rakiet przy strzale) | **tak**: rekordy, `lightAt` ← `Core3D.sunVisibilityAtWorld`, `__cloakLook`, `skipDraw` | co do piksela | ~1500 rekordów (sync 0,22 ms, rysunek 0,11 ms) |
| myśliwce `drawFighterSprite` (`drawNPCPretty`, `index.html:25827–25850`) | encja — JEDYNY obraz (bez ciała belek i modelu 3D) | fiz. `npc.x/y/angle`; rakiety Osa też 2D (`forceCanvas`) | nie | średnia | 0 – setki |
| paski NPC (`drawNpcStatusBars`) | nad kadłubem | fiz. | nie | luźna | NPC z ubytkiem w kadrze |
| leniwa budowa kadłubów NPC w `drawNPCPretty` (`index.html:25852–25877`, budżet 6 ms; dla WSZYSTKICH NPC, też poza kadrem) | — | — | zapis do 3D (`prewarmHexShipVisual` → `Core3D.queueTextureUpload`) | — | do 6 ms/klatkę — **logika gry w przebiegu 2D** |
| pasek HP gracza; sprite gracza bez ciała | kadłub | interp. (`camera.zoom`) | nie | luźna / ciasna | 1 / 0 w grze |
| liny holownicze (`drawTowRopes`) | punkty kadłubów | krok fizyki | nie | średnia | kilka |
| pociski 2D (`drawBulletVisual`) | punkt | `px → x · alpha` | **tak**: `__renderedByThree` z `WeaponFx.sync` | średnia | Osa w locie (zapas) |
| cząstki, błyski, pierścienie fal (`CanvasVFX`) | punkt + nośnik | `SimClock` | nie | luźna | do 4500 / 48 |
| skan X (`scanOverlay.js:108–408`) | AABB kadłuba + 5 px | fiz., `project` | nie | kilka px | kontakty z 10 s, ≤ 6 podpisów |
| cele misji, mgła wojny (sygnatury, duchy), cele priorytetowe, zaznaczenie RTS (+ 4 px), rozkazy, chmary | kadłub / punkt | fiz. / interp. | nie | kilka px – luźna | dziesiątki |
| wokół gracza: kompas łuków, kurs warpa, stabilizator, linia Hexlance, okrąg zasięgu, strzałki, wachlarze torped, skaner wydobycia | gracz / wyrzutnie / skały | interp. / fiz. | nie | luźna – średnia | 1 |
| etykiety planet, bramy warpa, ikony infrastruktury | dane świata | — | nie | luźna | wszystkie planety, N·(N−1) × 2 kreski |
| platformy najemnika, drony zwiadu | encja — jedyny obraz | fiz. | nie | średnia | kilka |
| ekranowe: celownik przy kursorze, koło trybów, menu PPM, CIC, PiP drona, banery, groty krawędzi; osobne kanwy `#turretPanel`, `#radarCanvas`; znaczniki fabuły w DOM (`st-marker`, kamera BEZ wstrząsu) | ekran / kursor | mysz | nie | obojętna | — |

Martwe: `drawSunDirection` (nigdzie niezdefiniowane), stacje 2D (`USE_STATION_3D = true`), `radarUiActive = false`,
`drawFlyingHexDebris` (`spawnFlyingHexDebris` nikt nie woła). Możliwy błąd z kodu (niesprawdzony w grze): wieżyczki
okrętów pod niezanikającym dachem hali doku piratów rysują się NA dachu (nakładki są nad FG).

**Skala rozjazdu jednej klatki** (domyślny zoom ~0,21 px/j., `cameraRig.js:480`): lot 500 j/s ≈ 1,8 px na klatkę
przy 60 Hz, 1500 j/s ≈ 5 px, 3000 j/s ≈ 11 px (przy zoomie 1 — × 4,7); wstrząs kamery (do 16 px, 12 Hz,
`cameraRig.js:64–65`, `503–507`) — do ~26–31 px między sąsiednimi klatkami; sprężyna zoomu przesuwa obraz
proporcjonalnie do odległości od środka ekranu.

### 2.8 Skrypty narzędzi czytające Core3D w stronie

`scripts/webgpu`: 92 pliki (86 `.mjs` + 6 pomocniczych `.js` wstrzykiwanych do strony: `harness-strona.js`,
`bloom-parzystosc-strona.js`, `efekty-kontrola-strona.js`, `ring-mapa-strona.js`, `ring-tsl-parzystosc-strona.js`,
`pad-atrapa.js`). Czyta `Core3D`: 63; otwiera grę (`index.html`): 59; **otwiera grę i czyta `Core3D` w stronie: 56**.
Najczęstsze odczyty: `Core3D.isInitialized` (53 pliki), `gpuReady` (32), `renderer` (16), `gpuFrameMs` (10),
`render` (8), `setPerfToggles` (8), `renderer.backend` (5), `fx.lights` (5), `scene.add` (4), `warmup` (4),
`scene.traverse` (3), `fxStats` (3), `lastFramePerf.renderTotalMs` (3).

Rodzaje dostępu w 56 skryptach gry (skrypt może mieć kilka):

| rodzaj | skryptów | w workerze |
|---|---|---|
| gotowość (`isInitialized`, `gpuReady`, `ready`) | 55 | fasada `window.Core3D` na wątku głównym z flagami z `RET` |
| pomiary (`gpuFrameMs`, `fxStats`, `lastFramePerf`, `warmup.stats`, `renderer.info`, dziennik pipeline'ów) | 21 | `RET` (liczniki) + `RenderDebug.call` |
| sterowanie (`setPerfToggles`, `render`, `renderSingle`, `setMsaaEnabled`, `fx.lights`, `setSunOcclusionField`, `syncCamera`) | 12 | rozkazy / `RenderDebug.call` |
| introspekcja sceny i GPU (`scene.*`, `renderer.backend`, `_runScenePass`, `sunShadowTarget`, `readRenderTargetPixelsAsync`, `traverse`) | 16 | wykonanie W WORKERZE (CDP: cel workera, `Runtime.evaluate`) |

Skrypty z introspekcją: `asteroidy-gra`, `drzenie-gra`, `dym-gra`, `gorace-powietrze`, `koszt-klatki`, `maska-slonca`,
`niebo-gra`, `planety-gra`, `post-kontrola`, `rakiety-sekwencje`, `resize-gra`, `rozpad-stacji`, `silniki`,
`sprawdz-wysylki`, `widocznosc-gra`, `zrzuty`. Harness strony (`harness-strona.js`) podmienia w STRONIE
`performance.now`, `Date.now`, rAF i `Math.random`, prowadzi dziennik klatek i pipeline'ów (`window.Core3D.renderer`)
i ustawia ziarno `window.fxRandom` — w workerze nic z tego nie działa samo (§ 3.5, RW-44).

### 2.9 DOM i `window` w modułach renderu (blokery workera)

Moduły renderu ładowane przez grę: 244 pliki, 106 625 linii. Wzorce (skrypt `inwentarz.mjs`, sekcja DOM): `window.`
312 odwołań w 48 plikach (większość to zapisy strojeń `window.*Tune` do konsoli i odczyty zmiennych gry z § 2.4),
`document.` 20 w 15, `createElement(` 16 i `getContext('2d')` 17 (kanwy pomocnicze tekstur), `Image` /
`HTMLImageElement` 16, `TextureLoader` / `ImageLoader` / `GLTFLoader` 8, `requestIdleCallback` 15, `addEventListener` 2,
`devicePixelRatio` 2, `requestAnimationFrame` 2, `localStorage` 1, `new Worker` 1. Pliki z DOM poza `window.`:

| plik | co |
|---|---|
| `src/3d/core3d.js` | `document.getElementById('webgl-layer')` (`:732`), `requestIdleCallback` 3, nasłuch, `devicePixelRatio` 2 |
| `src/3d/planet3d.assets.js` | kanwa 2D, `TextureLoader` 2, 57 × `window.` (globalne API planet) |
| `src/3d/menuBackdrop3D.js` | `document` 3, rAF 2, nasłuch, `TextureLoader` |
| `src/3d/stations3D.js` | `TextureLoader` 4 (GLB i tekstury stacji) |
| `src/3d/hullLacquer.js`, `src/3d/hullShadowSdf.js`, `src/3d/hullSurface.js` | kanwy 2D i obrazy (już z gałęzią `OffscreenCanvas`, gdy dostępna) |
| `src/3d/haloRing/arch/fable.js`, `ecumene.js`, `src/3d/haloRing/haloPortK7.js`, `src/3d/portBuildings/portBuildings3D.js`, `src/3d/fxParticles3D.js`, `src/3d/hexBodyImpostorBatch.js`, `src/3d/ships3d/shipMaterials3D.tsl.js` | kanwy 2D tekstur (atlasy napisów, szumy, rampy) |
| `src/3d/worldBodies3D.js`, `src/3d/shield3D.js`, `src/3d/rozgrzewka.js`, `src/3d/portBuildings/portBuildingSkin3D.js` | `requestIdleCallback` (praca w tle) |
| `src/3d/bloomConfig.js` | `localStorage` (strojenie bloomu z `?dev`) |
| `src/vfx/turret2D.js`, `src/vfx/fighterSprite.js` | kanwy 2D — moduły kanwy gry, zostają na wątku głównym |

Workery w workerze są dozwolone (wypiek mapy powierzchni kadłubów `hullSurfaceWorker.js`, olbrzymy
`asteroidGiantWorker.js` — zagnieżdżone workery dedykowane działają w Chromium). three r183 przyjmuje
`OffscreenCanvas` (`node_modules/three/src/renderers/common/Backend.js:668`, `webgpu/WebGPUBackend.js:278`), a
rdzeń renderera WebGPU nie używa `document`.

## 3. Projekt

### 3.1 Architektura i przebieg klatki

```
WĄTEK GŁÓWNY (gra, UI, kanwa 2D, dźwięk)                         WORKER RENDERU (Core3D, moduły 3D, GPU)
pumpInput → physicsStep ×n (120 Hz) → rakiety → fabuła
   │  zdarzenia (strzał, trafienie, krater, wybuch, warp…)
   ├──────────── pierścień rozkazów (SAB, SPSC) ───────────────►  dyspozytor: rekordy klatek ≤ k, w kolejności
   ▼
RenderBridge.pack(k) → strona migawki S_k (SAB, potrójny bufor) ──►  RenderMirror: lustra encji, ciał, list, kamer
   │                                                                  moduły 3D bez zmian shaderów → Core3D.render
   ▼                                                                              │ OffscreenCanvas
nakładki 2D (#c) ◄── kanał zwrotny: SAB (gotowość, statystyki, przebicia tarcz) + postMessage (mapy, bitmapy) ◄┘
```

- Wątek główny nigdy nie czeka na worker (`Atomics.wait` jest na nim zabronione, a czekanie oddałoby zysk). Worker
  ma własną pętlę `requestAnimationFrame` (dedykowany worker z `OffscreenCanvas` ją ma): bierze NAJNOWSZĄ opublikowaną
  stronę (starsze pomija), odtwarza rozkazy do jej numeru klatki, aktualizuje lustra, renderuje, pisze kanał zwrotny.
- Fizyka zostaje w 120 Hz na wątku głównym. Worker dostaje pozy, jakie rysuje dziś render: gracz i P2 interpolowani
  (`__interpShipPose`, `bridgeRenderPose`), NPC i wraki w pozie fizycznej — sam niczego nie przewiduje.
- `RenderBridge` ma trzy tryby (flaga URL): `off` — dzisiejsze wywołania wprost; `inline` — migawka, lustra i rozkazy
  na wątku głównym, w tym samym zadaniu co dziś (etapy 1–3; każda zmiana sprawdzalna zrzutami bit w bit); `worker` —
  etap 4. `inline` zostaje na stałe jako zapas (brak WebGPU w workerze, debug, harness).
- Kod szwu w nowym katalogu `src/render/` — czyste moduły bez three, DOM i `window`, testowane w Node; importują je
  obie strony.

### 3.2 Migawka klatki

**Bufor i układ.** Jeden `SharedArrayBuffer` na zestaw: nagłówek potrójnego bufora + 3 strony. Strona = bloki
o STAŁYM układzie opisanym tablicą offsetów w czystym module (wzór: `HALL_DUST_IN`,
`src/3d/gasField/hallDustLayout.js`) — `src/render/snapshotLayout.js`; widoki `Float64Array` / `Float32Array` /
`Int32Array` / `Uint8Array` na tym samym buforze, tworzone raz. Pojemności (sloty, węzły, pociski…) rosną przez NOWY
zestaw SAB z numerem generacji układu (`postMessage`) — worker przełącza się na granicy klatki; bez alokacji w klatce.

**Potrójny bufor — poprawny.** `TripleFloat32Buffer` z `src/physics/sharedBuffers.js` NIE nadaje się wprost: pisarz
bierze stronę `(published + 1) % 3`, a czytelnik nie rezerwuje strony, którą czyta — przy czytelniku wolniejszym niż
pisarz (worker renderuje ~10 ms, wątek główny bez 3D publikuje co ~5 ms) dwie publikacje wystarczą, żeby pisarz
nadpisywał stronę w trakcie odczytu. Wzór klasyczny, bez blokad: trzy indeksy — `back` (prywatny pisarza), `front`
(prywatny czytelnika), `mid` (wspólny Int32 w SAB z bitem NOWA):
- publikacja: pisarz zapisuje stronę `back`, potem `prev = Atomics.exchange(H, MID, back | NOWA)`, `back = prev & 3`;
- odbiór: gdy `Atomics.load(H, MID) & NOWA` — `prev = Atomics.exchange(H, MID, front)`, `front = prev & 3`.

Pisarz nigdy nie dostaje strony czytelnika; `Atomics.exchange` jest sekwencyjnie spójny (zapisy strony przed publikacją
są widoczne po odbiorze). `SpscFloat64Ring` z tego samego pliku ma poprawny protokół indeksów (dane, potem
`Atomics.store` indeksu) — wzór dla pierścienia rozkazów (§ 3.3).

**Sloty (slot + generacja).** Encje gry nie mają wspólnego stałego id (NPC rozpoznaje się po tożsamości obiektu;
moduły 3D trzymają stan w `WeakMap` po encji i po obrazie). Rejestr `renderIds` (czysty moduł gry): slot =
najmniejszy wolny, generacja rośnie przy zwolnieniu, slot zwalniany dopiero, gdy obiekt zniknął ze wszystkich list
migawki. Osobne przestrzenie slotów dla encji, CIAŁ belek (wrak dziedziczy ciało rodzica, odłamy dostają nowe — render
szuka gospodarza po `dmgKey` i `body.entity`), pocisków (nie wszystkie mają `serial`) i zasobów (obrazy). Wzór pary
slot + generacja: `PhysicsKernel.bodyGeneration` (`src/physics/physicsKernel.js`). Worker przy zmianie generacji
tworzy NOWE lustro i zwalnia stare (jak dziś `invalidateHexShipEntity3D`).

**Wzorce z `src/physics/` i z migawki AI.** Z `src/physics/` nadaje się protokół indeksów `SpscFloat64Ring` (pierścień
rozkazów, § 3.3) i para slot + generacja `PhysicsKernel`; `TripleFloat32Buffer` — nie (wyżej), a całe rusztowanie
(`PhysicsBridge`, `hexArena`) powstało pod silnik heksów i nic go nie zasila. Migawka sąsiadów AI
(`src/ai/aiSpatialGrid.js`, `AINeighborSnapshot`) daje wzór PAKOWANIA: struktura tablic typowanych, kinematyka
odświeżana raz na krok jednym przejściem po obiektach (`refreshKinematics` / `syncTick`), pola drogie leniwie raz na
epokę (`shieldOf`), kolejność slotów = kolejność dawnej ścieżki (wynik bit w bit), bez stempli na obiektach — i pomiar,
że odczyt pól ~150 NPC o ~65 klasach ukrytych jest megamorficzny (~80 ns), więc każde pole czyta się RAZ na klatkę.
Różnica: migawka AI żyje w jednym wątku (zwykłe tablice, `refs` do obiektów); migawka renderu musi być w SAB i bez
referencji.

**Bloki strony** (rozmiary — § 2.3):

| blok | zawartość | typy |
|---|---|---|
| HEAD | numer klatki k; czasy bezwzględne (§ 3.5); W, H, DPR; kamera P1 (`cam` ze wstrząsem i `camNoShake`: x, y, zoom), kamera 3D (pozycja, kwaternion, fov, near, far, `viewDistance` — to, co czyta `Core3D.syncCamera`), kamera P2 i podzielony ekran, `View3D`, pudło cullingu (`_hexCullInfo`); strefa nieba; flagi (pauza, `worldFrozen`, CIC, opcje obrazu); id gracza i P2; liczniki bloków; numer ostatniego rozkazu klatki | Float64 |
| LISTS | kolejność slotów list, które moduły dostają jako tablice: `renderEntities`, `renderSeen` (po mgle wojny), `npcs`, `wrecks`, `coldWrecks`, stacje, `worldBodies` — kolejność wpływa na partie (kolejność w partii = kolejność dodania) i jest warunkiem zrzutów bit w bit | Int32 |
| ENT | rekord na slot encji: poza (x, y w Float64; kąt, vx, vy, ω, z), flagi (strona, wrak, odłam, gracz, ukryty mgłą, hulk mostka, reflektory wył., maskowanie…), kody profilu wyglądu i modelu 3D, stan napędu (`thrusterInput`, `input`, dopalacz, tryb warpa), tarcza (`max, val, state, activationProgress, hardness, show`), wygląd maskowania (wektory a–e z `cloakLook.js`, liczone po stronie gry), wersje (kadłub, magazyn, skóra, mostek, lampy, układ dysz), slot ciała | Float64 + Float32 + Int32 |
| BODY | rekord na slot ciała belek: kotwica i skala, `latticeMin`, `pivot`, granice, `activeNodes`, generacja magazynu, uśpione, offset i liczba węzłów w NODES | Float64 + Int32 |
| NODES | węzły ciał w pudle rozgrzania, które zmieniły się od ostatniej strony ODEBRANEJ przez worker (numer w `RET`): `x, y` (Float64 — kopia `nodeStore` przez `TypedArray.set`, bez pętli), `active`, `heat`, `heatStamp` (+ `hp / maxHp` pod mostkami); węzły są w układzie CIAŁA, więc okręt w locie bez odkształceń nie zmienia NODES — rusza się tylko poza w ENT | Float64 + Uint8 |
| SKIN | belki ciał zmienionych j.w. (`broken`, `rest`), przesunięcie `_recentre` / `shiftBodyOrigin` jako (mx, my); topologia magazynu (`ix, iy`, belki `a, b`, `restBase`, sąsiedztwo) — RAZ na konstrukcję (wspólna dla typu kadłuba, `cloneStructure`), przy podmianie magazynu (rozpad, odrost) — w pierścieniu albo `postMessage` | Float64 + Int32 + Uint8 |
| NOZZLES | na dyszę: `nozzleDeg`, `__throttle`, `vfxScale`, maska żywotności; układ dysz (offset, kierunek, gimbal) — przy podmianie tablic | Float32 |
| SHOTS | pociski w locie: slot, x, y (Float64), vx, vy, vz, z, ivx, ivy, życie, wiek, kod broni / rodziny, flagi (`forceCanvas`, zegar), `bornSim`, `visZ0`, stan torpedy | Float64 + Float32 + Int32 |
| ROCKETS | slot, stan, pozycja xyz, prędkość xyz, pęd wyrzutni, kierunek nosa, pochylenie, ciąg, skala, faza końcowa, czas od wyrzutu (po RW-23; dziś pula `rocketSystem3D`) | Float64 / Float32 |
| TURRETS | rekordy wież tej klatki (`Turret2D.sync` po stronie gry — RW-26): encja, gniazdo, wx, wy, kąt, skala, odrzut, lufa, kod broni | Float32 + Int32 |
| WORLD | stacje (poza, model, `_destroyed3D`, ukryta mgłą), dok (alarm, maski stanowisk, stany 39 kawałków), ring (pozy obsługi stanowisk 3 × 16 × 6, zajętość, lampki, zegar migania, nadpisanie dachu, jakość), pas (zegar skał, 7 statków ze światłami, wersja `taken`), planety (jeśli ruchome), warp gracza (`warp.*`, `exitRamp.*`, indeks celu), tło menu (aktywne, ognisko, wskaźnik) | Float64 + Int32 |
| CORES | rdzenie od stanu EXPOSED (stan, integralność, stopienie, komórki, gospodarz), strugi i kule | Float32 + Int32 |
| HALL | kopia `HALL_DUST_IN` (pył hal; maski obrysu tylko przy zmianie wersji — pola 14–15 rekordu na wersję i id) | Float64 |

**Reguła pakowania bloków zmiennych (NODES, SKIN, stany wersjonowane):** do strony k trafiają obiekty, które zmieniły
się PO ostatniej klatce odebranej przez worker (`RET.lastConsumed`), a nie tylko w klatce k — inaczej zmiana z pominiętej
strony przepadnie. Worker porównuje nowe wartości z repliką (różnicowanie 45 tys. węzłów — szac. ~0,05–0,1 ms) i wysyła
na GPU tylko zmienione czworokąty skóry — bez dzisiejszego protokołu brudnych węzłów, który czyści RENDER
(`clearHullSkinDirty`, `body.meshDirty = false`). Delty węzłów przez pierścień (bez pełnych kopii) — optymalizacja
etapu 5.

**Liczby.** Świat w Float64 (5–10 mln j.; float32 ma tam krok ~1 j.), wartości względne i wizualne w Float32, kody
w Int32. Napisy (id broni, profil wybuchu, rodzina stempla, profil kadłuba) jako indeksy słowników z modułów danych
(`src/data/weapons.js`, `src/data/ships.js`…) — ten sam porządek w obu realmach, bo to ten sam kod. W trybie `inline`
żadnego zaokrąglenia do Float32 tam, gdzie dziś render liczy na Float64 (warunek bit w bit).

### 3.3 Strumień rozkazów

**Pierścień.** SPSC na SAB, rekordy ZMIENNEJ długości w `Float64Array`: `[typ · 2^16 + słowa, klatka, …ładunek]`
(liczby całkowite < 2^53 mieszczą się dokładnie). Jeden pisarz (wątek główny), jeden czytelnik (worker). Nowa klasa
`src/render/eventRing.js` — protokół indeksów jak `SpscFloat64Ring`, ale bez stałego kroku i bez obiektu rekordu
(pisanie wprost do widoku).

**Semantyka.** Rekordy w kolejności powstania (jak dziś kolejność wywołań; haki mapy ran z fizyki muszą wyprzedzać
receptury tej samej klatki — dedup krater ↔ receptura). Worker przed renderem migawki k odtwarza WSZYSTKIE rekordy
z klatkami ≤ k — także z klatek, których migawek nie narysował (efekty się sumują, migawki nie). Rekord nie trzyma
referencji: encja = (slot, gen), pocisk = slot + skopiowane pola, które receptura czyta przy narodzinach (dziś
`WeaponFx.impact(b, …)` czyta żywy pocisk), nośnik = skopiowany wynik `writeCarrier` (`C` niżej). Efekty, które przez
czas życia czytają ŻYWĄ encję (wiązki ciągłe, impulsy PD, wyrwy `ctx.burn`, przypalenie rakiety, wtórne Yamato —
§ 2.5), dostają slot encji i czytają lustro z migawki. Odtworzenie w innej chwili daje te same liczby — warunek bit
w bit w trybie `inline`.

**Katalog rekordów** (pozycje świata f64, reszta f32, encja = slot u32 + generacja; `C` = blok nośnika
`{vx, vy f32, t0 f64, zegar u8, z f32}` — rozwiązany w grze, bo `writeCarrier` zależy od `SimClock`, `window.ship`
i `__interpShipPose.z`, `carrierVelocity.js:58–86`):

| rekord | pola | zastępuje |
|---|---|---|
| `SHOT` | broń u16, strzelec, x, y, dirX, dirY, skala wstrząsu, flagi; lufa ROZWIĄZANA w grze (mx, my, kąt, skala, wstrząs odrzutu, muzzleZ), C | `WeaponShotBus` → `_onShot`, `pdShot` |
| `BEAM` | broń, strzelec, rodzaj (ciągła / impuls / PD), emiter u32 (hasz napisu `emitterUid`), sx, sy, ex, ey, szerokość, trafiona encja, nx, ny | wiązki z szyny, `pdLaser` |
| `IMPACT` | id pocisku, broń / typ, rozmiar, właściciel, x, y, skala, rodzaj trafienia, trafiona encja, nx, ny, relVx, relVy, flagi (przelot, rykoszet, gracz), kierunek / prędkość / życie rykoszetu, promień flaku, z, C | `impact` (bramki ekranu i cooldownu zostają w grze) |
| `KERF`, `PIERCE` | id pocisku, broń, rozmiar, (właściciel, zakleszczony), punkt, kierunek / liczba znaków, prędkość względna, kadłub, C | `kerf`, `pierceExit`, `pierceStuck` |
| `FLAK_BURST`, `DRONE_BLAST` | punkt, promień / rozmiar, C | `flakBurst`, `droneBlast` |
| `CHARGE` | klucz działa u32 (encja · gniazdo), broń, x, y, kąt, skala, u, dt (suma w klatce), C | `charge` (stan ładowania przechodzi do workera po kluczu) |
| `HEX_CHARGE`, `HEX_FIRE`, `HEX_PROJ`, `HEX_HIT` | gniazdo / pocisk Hexlance, punkt, kierunek, u, dt, moc, wstrząs, C; pociski Hexlance w bloku migawki | `hexlance*` (uchwyt `slug` → id po stronie gry) |
| `RKT_LAUNCH`, `RKT_IGNITE`, `RKT_SPLIT`, `RKT_DETONATE` | slot rakiety, broń, wroga, tryb, pozycja xyz, kierunek, pochylenie, prędkość, pęd wyrzutni, skala; detonacja: trafiona encja, flagi (tarcza, kontakt, gracz, nova), punkt i normalna styku, prędkość trafionego, tarcza (życie, promień) | `onLaunch`, `onIgnite`, `onSplit`, `prepareContact` + `onDetonate` |
| `EXPLOSION` | x, y, rozmiar, profil u8, vx, vy | `makeReactorBlow` |
| `SPARK_GRIND`, `SPARK_IMPACT` | liczba, wzmocnienie, approach, slide, styczna, prędkość bazy, ≤ 6 punktów (x, y f64, nx, ny) | `collisionSparks` (budżet liczony w grze) |
| `HULL_DEBRIS` | x, y, vx, vy, rgb, rozmiar komórki, flaga konstrukcji | `spawnHullDebris` (losowanie skali i konstrukcji → do workera) |
| `RX_DETONATION`, `RX_ORB_BURST`, `RX_SECONDARY`, `RX_MELT` | rdzeń, gospodarz, punkt, wariant, klasa, barwa, promień, prędkość, wrak, krater, cięcia, krawędzie (punkt + encja odłamu), trafienia (encja, punkt, normalna, t) | haki `reactorBlastFx` (rdzenie, strumienie i kule — bloki CORES migawki) |
| `DMG_HOOK`, `DMG_TEAR`, `DMG_KERF`, `DMG_REPAIR` | encja, `dmgKey`, rzaz / krater, punkt, uv (gra liczy je w `HullBodies`), promień, zabite węzły, długość, kierunek, rodzina, wariant, moc, promień flaku | haki `HullBodies.onImpact / onNodeLost / onRepair`, `setSource / clearSource`, `stampKerf`, `jetCut` |
| `SHIELD_IMPACT` | encja, x, y, obrażenia, klasa efektu | część obrazowa `registerShieldImpact` (stan tarczy zostaje w grze) |
| `STATION_FX` | stacja, rodzaj (kawałek / rozpad), opcje | `Destruction3D.detachChunk(station._mesh3d)`, `destroyStation3D` (dziś gra trzyma mesh three) |
| `ENTITY_FX` | encja, rodzaj (inwalidacja kadłuba, wypiek zimnego wraku, zmiana profilu) | `invalidateHexShipEntity3D`, `captureColdWreckImpostor` |
| `WARP_*`, `DOCK_*`, `SCENE_*`, `OPT_*`, `RES_*`, `RESET` | przyloty / odloty wg harmonogramu gry, stan kawałków doku, sceny (planety, stacje, pas, ringi, tło menu), opcje, zasoby (klucz), czyszczenie pul | § 2.3, § 2.6 |

**Przepełnienie.** Pojemność na szczyt bitwy × 4 klatki (§ 2.5: ~70–170 rekordów na klatkę, łańcuch doku ~1750
odłamków/s). Brak miejsca → wątek główny zakłada większy pierścień i wysyła go `postMessage`; worker dopija stary do
końca (bez gubienia). Licznik „pierścień pełny” w `RET`. Duże ładunki (obrazy, topologie magazynów, SDF olbrzymów,
wypieki) — `postMessage` z transferem albo SAB, w rekordzie tylko klucz.

### 3.4 Kanał zwrotny

- **SAB `RET`** (pisze worker, czyta gra): numer ostatnio ODEBRANEJ i ostatnio NARYSOWANEJ migawki oraz ostatniego
  rozkazu; flagi (`gpuReady`, `ready`, `gpuUnsupported`, utrata urządzenia, `fxReady`); statystyki (`gpuFrameMs`, CPU
  workera, draw calle, `fxStats`, pomijane strony, pipeline'y synchroniczne); postęp rozgrzewki; PRZEBICIA TARCZ (per
  slot puli: slot encji, generacja, klucz profilu, epoka, 128 słów bitów — dziś `getArrayBufferAsync` co 0,1 s, więc
  semantyka bez zmian); dyski cienia planet (≤ 48 × 4 f32) dla jasności wieżyczek 2D, jeśli lustro maski słońca nie
  będzie liczone w grze.
- **postMessage** — wyniki jednorazowe i duże: `bankRadius` (655 KB, raz — dopiero po nim powstaje wydobycie),
  `ringReady{key, profil z = 0}` (16 KB dla Ziemi), koniec `warmup.flush`, `launchDone{pose, sunLocal}` i
  `flightDone{ImageBitmap}` tła menu, błędy; w kompozycji B — bitmapy klatek (transfer `ImageBitmap`).
- **RPC debug** (`RenderDebug.call(nazwa, …)`, lista dozwolonych): statystyki, `warmup.stats`, `renderer.info`, spis
  materiałów, odczyt celu, strojenia (`*Tune`) — dla harnessu i konsoli.
- **Zasada: żadnego synchronicznego zapytania gry do renderu.** Każde dzisiejsze zapytanie (§ 2.1, grupa
  „zapytanie”) dostaje jedną z trzech dróg: (a) liczone po stronie gry z czystych modułów — większość
  (`shipModel3DIdFor`, `turretMuzzleZ` → do workera razem z wysokościami pocisków, `cloakLook`, `Turret2D.sync`, kolidery
  ringu, pas, dok, harmonogram warpa); (b) wynik z opóźnieniem przez `RET` (przebicia tarcz, statystyki, gotowość);
  (c) raz przez `postMessage` (bank skał, profil terenu ringu, koniec rozgrzewki).

### 3.5 Zegary

- `performance.now()` workera ma INNY początek (`timeOrigin` workera) i nie podlega harnessowi (wirtualny czas
  STRONY go nie dotyczy). Worker nie używa własnego zegara do niczego, co zmienia obraz; własny zegar tylko do
  profilowania i taktowania rAF.
- **W migawce czasy BEZWZGLĘDNE, nie przyrosty** — pominięta strona nie może zgubić czasu (lekcja z pyłu hal: dziś
  `HALL_DUST_IN.dt` liczone przy świeżej migawce — przy SAB „wygrywa ostatnia” i dt pominiętej przepada). HEAD niesie:
  `SimClock.sim`, `render`, `renderSim`, `alpha`, krok fizyki, monotoniczny czas klatki (suma `frameDt`, stoi w pauzie
  tam, gdzie dziś stoi), osobno czas gry (stoi też w scenach fabuły), `vfxTime`, `bridgeSimTime`, zegar ściany wątku
  głównego w chwili pakowania (dla `heatStamp` węzłów, miganie świateł hal, rampy dysz — dziś każdy z tych modułów woła
  `performance.now()` sam), znacznik rAF. Worker liczy swoje dt jako różnicę czasów kolejnych ODEBRANYCH stron.
- Zegar efektów `Core3D.fx.time` (dziś: krok z klatki rAF ≤ 0,1 s, także w pauzie) w workerze = czas klatki z HEAD.
- Porównania między wątkami (opóźnienie, dziennik): `performance.timeOrigin + performance.now()`.
- Harness (`scripts/webgpu/harness-strona.js` podmienia w stronie `performance.now`, `Date.now`, rAF i `Math.random`,
  ziarno `window.fxRandom`): wystarczy, gdy worker bierze czas wyłącznie z migawki; ziarna strumieni efektów idą do
  workera rozkazem; zrzut po barierze `RET.lastRendered ≥ k` (RW-44).

### 3.6 Lustra encji

- Worker trzyma na slot obiekt-lustro o STAŁEJ klasie ukrytej, aktualizowany W MIEJSCU (moduły 3D trzymają cache
  po tożsamości obiektów — klon co klatkę by je zabił) — z polami, które moduły 3D czytają dziś (§ 2.3: `x, y, angle,
  vx, vy, …`, `shield.*`, `bridgeState.*`, `beamHull.body.nodeStore.{x, y, active, heat, …}` jako repliki aktualizowane
  z NODES, `visual.mainThrusters[i].__throttle` z NOZZLES…). Moduły 3D nie zmieniają się (te same nazwy pól), dostają
  listy luster w kolejności z LISTS. Moduły czytające globale gry (`window.ship`, `window.SUN`, `GameState.ship`,
  `window.bullets`…) — przez fasadę `RenderWorld` zasilaną z migawki (RW-12).
- Zapisy renderu do obiektów gry (§ 2.3: `__cloakLook`, `__hiddenFromView`, `__engineFxFallback`, `_shadowGrid`,
  `__skin3D`, `__warpHullU`, `__warpNurtMode`, `body._lattice`, `b.__fx`, `b.visZ0`…) lądują w lustrach — gra ich nie
  widzi. Te, które gra czyta (`__cloakLook` dla kanwy 2D, `__renderedByThree`, `__shieldBreach`, `_dockGone`,
  `station._mesh3d`), muszą wcześniej przejść na stronę gry (etap 2).
- Ten sam kod w trybie `inline`: lustro bez pola, które moduł czyta, daje różnicę w zrzucie — test kompletności
  inwentarza; w trybie dev lustro może być `Proxy` zgłaszającym odczyt nieznanego pola.
- Możliwa korzyść bez workera (hipoteza do pomiaru, RW-11a): dziś pętle renderu czytają encje o ~65 klasach ukrytych
  (pomiar przy migawce AI: ~80 ns na odczyt megamorficzny, `src/ai/aiSpatialGrid.js`); lustra mają jedną klasę.

### 3.7 Wzorzec już działający: pył hal K-7

`src/game/hallDustInput.js` (strona gry, czysta) pakuje wejście klatki do `Float64Array` o stałym układzie
`HALL_DUST_IN` (`src/3d/gasField/hallDustLayout.js`: nagłówek `serial, dt, active, hall`, przekształcenie hala → gra
w double, 16 rekordów `HALL_DUST_SHIP` po 80 liczb z maską obrysu 64 × 32 bity, blok obsługi stanowisk; razem 1320
liczb = 10,5 KB); `HallDust.submit(tablica)` kopiuje ją, a krok `Core3D.addFxStep` czyta TYLKO tę tablicę
i `EngineFrame` (dysze MAIN tej klatki — dane innego modułu renderu, w workerze w tym samym realmie), sprawdza świeżość
po `serial`, maski porównuje słowo po słowie i wysyła teksturę tylko przy zmianie. W `src/3d/gasField` nie ma
`window`, DOM ani `requestIdleCallback` (strażnik `tests/hallDust.test.mjs`). Uogólnienie: każdy moduł dostaje własny
blok migawki o stałym układzie w czystym module układu; pakowanie po stronie gry jest czystą funkcją (testy Node);
moduł 3D czyta tylko blok. Przed workerem trzeba w tym wzorcu poprawić (§ 2.3, pył hal): przecieki renderu przez grę
(zegar, lampy, pozy stanowisk), `dt` → czas bezwzględny, maski tylko przy zmianie, strażnik importów przechodnich.

### 3.8 Kompozycja

**Dziś:** `#webgl-layer` (z-index 0) leży w DOM pod `#c` (z-index 1), ale klatkę 3D kopiuje `drawHexShips3D`
(`ctx.drawImage(Core3D.canvas)`, `hexShips3D.js:2351–2407`) na `#c`, po czym rysują się nakładki — 3D i 2D są z tej
samej klatki z definicji, z jednym obiektem kamery. Podzielony ekran = dwa `renderSingle` i dwie środkowe połowy.

**(A) Kanwa workera w DOM pod kanwą 2D.** `#webgl-layer.transferControlToOffscreen()` → worker; `#c` przezroczysta,
bez kopii (przy okazji 3D mogłoby iść w pełnej rozdzielczości urządzenia — dziś `#c` ma rozmiar w px CSS,
`index.html:1458`). Zero kopiowania pikseli na wątku głównym, najmniejsze opóźnienie 3D. Kompozytor pokazuje ostatnią
klatkę workera i ostatnią `#c` NIEZALEŻNIE — warstwy z różnych migawek (±1 klatka, przy wolnym workerze więcej). Każdy
ruch kamery przesuwa nakładki przyklejone do świata względem 3D o różnicę kamer (§ 2.7: 1,8 px na klatkę przy 500 j/s
i domyślnym zoomie, do ~26–31 px przy wstrząsie). Wymaga:
1. wieżyczek w workerze (zgodność co do piksela; WeaponFx i wieże 3D i tak potrzebują ich rekordów) — gotowa ścieżka
   to partie wież 3D z opcji „Bronie 3D” (`turretBatch3D.js`) albo kwady z obecnymi atlasami 2D na tych samych rekordach;
2. myśliwców (jedyny obraz to sprite na kanwie, bez ciała belek) — do sceny 3D jako kwady albo zostają 2D z rozjazdem
   względem PD i wybuchów 3D (decyzja D6); rakiety Osa przez `WeaponFx` (zdjąć `forceCanvas`);
3. nakładek-ramek (skan X, zaznaczenie RTS, cele, paski) z poprawką: worker odsyła numer pokazanej migawki, gra trzyma
   pierścień 2–3 kamer i póz i rysuje ramki kamerą tej klatki (marginesy 4–5 px są mniejsze niż skok kamery przy
   wstrząsie — bez poprawki ramki „pływają”); ekranowe (celownik, menu, CIC, panele) — bez zmian;
4. podzielonego ekranu w workerze (dwa widoki i wycinki).

**(B) Bitmapa klatki z workera, składana na wątku głównym z nakładkami tej samej klatki.** Worker renderuje do
OffscreenCanvas spoza DOM, `transferToImageBitmap()` → `postMessage` (transfer). Warianty:
- **B1** — nakładki z bieżącego stanu gry w chwili przyjścia bitmapy: proste, ale rozjazd jak w A;
- **B2** — nakładki klatki k rysowane jak dziś zaraz po fizyce i spakowaniu migawki k, ale do warstwy buforowanej
  z numerem klatki (OffscreenCanvas 2D albo druga kanwa `#c`, pierścień 2–3 warstw); gdy przyjdzie bitmapa k,
  w jednym zadaniu: `ImageBitmapRenderingContext.transferFromImageBitmap` na kanwie 3D (bez kopii) i pokazanie warstwy
  k; pominięta przez worker klatka = pominięta warstwa. Para klatka ↔ nakładki dokładna, cały obraz +1 klatka;
- **B3** — nakładka k jako `ImageBitmap` do workera i złożenie na GPU po poście (`copyExternalImageToTexture`): para
  przychodzi sama, kosztem kopii ~8 MB na klatkę przy 1080p.
Wymaga (B2): (1) nakładki zależne wyłącznie od stanu klatki k — dziś część tego stanu powstaje w przebiegu 3D TEJ
klatki: rekordy i odrzut wież, `__cloakLook`, `lightAt`, decyzja 2D / 3D pocisków (`__renderedByThree`), `slug`
Hexlance, `turretMuzzleZ` — wszystko na stronę gry (RW-26, RW-21); (2) rysunki zależne od kursora (celownik zastępujący
ukryty kursor systemowy, koło trybów, menu PPM, prostokąt zaznaczenia) — przy składaniu, z bieżącą myszą, inaczej
dostaną klatkę opóźnienia; (3) znaczniki fabuły w DOM (`st-marker`, dziś kamera bez wstrząsu) — pozycje z klatki k
w chwili składania; (4) efekty uboczne wyjęte z przebiegu 2D: leniwa budowa kadłubów NPC w `drawNPCPretty` (logika
gry, do 6 ms) i `prewarmHexShipVisual` (rozkaz do workera), spawn piorunów z rysowania pocisku; (5) podzielony ekran
i pauza (`render(0)`) — parowanie per widok.

**Kryteria wyboru (prototyp RW-02, potem gra):**
1. koszt wątku głównego na klatkę: A ≈ 0; B2 — `transferFromImageBitmap`, pokazanie warstwy, rysowanie nakładek do
   warstwy buforowanej (cel ≤ 0,2 ms dodatkowo przy 1080p i 4K);
2. koszt workera: `transferToImageBitmap` z kanwy WebGPU vs zwykła prezentacja;
3. opóźnienie: klatka migawki → klatka na ekranie (numer klatki wpisany w róg obrazu, odczyt zrzutem CDP), średnio i p95;
4. rozjazd: przesunięcie znacznika 2D względem znacznika 3D tej samej encji przy ruchu kamery i wstrząsie (A: px; B2: 0);
5. równość klatek: rozkład czasu między prezentacjami (p95, p99), także gdy worker jest wolniejszy od wątku głównego;
6. fps w bitwie 166 okrętów przy zoomie 0,1 i 0,45 (`scripts/profil-bitwy-flot.mjs`, A i B parami równolegle);
7. zakres przeróbek nakładek: A — wieże i myśliwce do workera + pierścień kamer dla ramek; B2 — warstwy buforowane,
   rysunki kursora przy składaniu.
Wstępna ocena (do potwierdzenia pomiarem): B2 zachowuje dzisiejszą gwarancję „3D i 2D z jednej klatki” kosztem jednej
klatki opóźnienia i bez przenoszenia rysunków; A daje najmniejsze opóźnienie, ale wymaga przeniesienia wieżyczek 2D
(domyślny tryb broni) i myśliwców oraz pogodzenia się z pływaniem ramek.

### 3.9 Ryzyka i pułapki

- **WebGPU w dedykowanym workerze** i `OffscreenCanvas` z kontekstem `webgpu` w Chromium Electronu 44.5.1 — tak w
  teorii (sprawdzić w RW-02, także `transferToImageBitmap` z kanwy WebGPU i rAF w workerze); three r183 przyjmuje
  `OffscreenCanvas` (`Backend.js:668`, `WebGPUBackend.js:278`), rdzeń renderera nie używa `document`.
- **Determinizm zrzutów:** kolejność list (partie), jeden strumień `fxRandom` gry i renderu (RW-20), `Math.random`
  w `reactor3D.js:299–300`, UUID three (w workerze własny `Math.random` — to akurat usuwa dzisiejszy problem
  „tysiące węzłów TSL przesuwają `Math.random` gry”, dla którego istnieje `--uuid osobne`).
- **`window` nie istnieje w workerze:** 312 odwołań `window.` w 48 modułach renderu; część ma osłonę `typeof window`
  i w workerze po cichu weźmie domyślne strojenia (konsola i panele F12 przestaną działać bez mostu), część nie ma
  (`hexShips3D.js:2212` `innerWidth` — `ReferenceError`; kanwy `arch/ecumene.js`, `arch/fable.js` — ringi Marsa
  i Jowisza się nie zbudują; `pirateStationFactory.js` — inna stacja piracka). Na start podkładka
  `globalThis.window = globalThis`, docelowo `RenderWorld` i most konsoli (RW-12, RW-35).
- **Zasoby w dwóch realmach:** sprite'y kadłubów potrzebne grze (kratownica belek z alfy, kanwa 2D) i renderowi
  (tekstury; tożsamość obrazu to klucz partii skór) — `ImageBitmap` w kopii do workera (pamięć × 2 dla sprite'ów),
  GLB, tekstury planet i bank skał worker ładuje sam; `TextureLoader` → `ImageBitmapLoader` (ignoruje `flipY` — sprawdzić
  tekstury planet).
- **Rozgrzewka:** pipeline'y kompilują się w workerze tak samo (to ten sam Core3D); ekran ładowania czeka na
  `warmup.flush` przez `postMessage`; pipeline'y compute (synchroniczne w three r183) dalej przy ekranie ładowania.
- **Pamięć dzielona dużych danych:** SDF olbrzymów (~52 MB) i cień pól (~12 MB) czyta i gra (kolizje), i render
  (tekstury) — SAB zamiast kopii.
- **Debug:** devtools pokazuje worker jako osobny cel; konsolowe API (`Core3DPerf`, `*Tune`, `HallDust.*`) wymaga mostu.
- **Opóźnienie wejścia:** B2 — +1 klatka obrazu; A — bez dodatkowego, ale z rozjazdem warstw.
- **Worker staje się wąskim gardłem przy zoomie 0,1** (~10–13 ms) — zysk ograniczony przez koszt aktualizacji 3D
  (`updateHexShips3D` 4,7–6,7 ms); optymalizacje renderu CPU działają dalej, tylko w workerze.

## 4. Plan etapów — zadania do osobnych sesji

**Zasady.** Każde zadanie kończy się zielonymi testami (`node --test "tests/*.test.mjs"`, `npm test`) i — gdy dotyka
obrazu — zrzutami harnessu bit w bit (`node scripts/webgpu/zrzuty.mjs --backend webgpu --uuid osobne --out
.tmp/webgpu/<katalog> --baza <baza sprzed zadania>` + `scripts/webgpu/porownaj.mjs`; sesje harnessu: `menu`, `ziemia`,
`ziemia-ring`, `mars`, `jowisz`, `kosmos`, `rakiety`, `split`, `stacja`, `reaktor`, `warp`, `warp-kop`, `galeria`, `pas`,
`wydobycie`, `piraci`). Wydajność — `node scripts/profil-bitwy-flot.mjs --sklad 50,20,10,3` w parach A/B uruchamianych
RÓWNOLEGLE (tło maszyny waha się ~3×). Etapy 0–3 działają na jednym wątku; korzyść bez workera podana przy etapie.

**Trwające sesje (2026-10-07) — pliki, z którymi zadania kolidują:** renderu CPU w bitwie (`src/3d/hexShips3D.js`,
`src/3d/engineVfxSystem.js`, `src/3d/core3d.js`, `render()` w `index.html`); odrostu węzłów kadłuba
(`src/game/hullBodies.js`, silnik belek, skóra, naprawa w `index.html`); misji 2 (`src/game/story/*`, blok „FABUŁA”
w `index.html`, `src/game/supportWarp.js`). Zadania etapu 0 są w nowych plikach i mogą iść od razu.

```
etap 0:  RW-01 strażnik ─┐   RW-02 prototyp kompozycji ──────────────────────────► D1 ──► RW-42, RW-43
         RW-03 sloty ────┼─► RW-10 migawka ─► RW-11a/b/c lustra ─┐
         RW-04 bufory ───┘                                      │
etap 1:  RW-12 RenderWorld (po RW-01)                            │
etap 2:  RW-20 fxRandom ─► RW-21 rozkazy: broń ─► RW-22, RW-23, RW-28, RW-30, RW-31
         RW-26 wieże / maskowanie (wcześnie, niezależne) ─► RW-21
         RW-24 dok (po RW-22), RW-25 pas, RW-27 ring (po RW-12), RW-29 tarcze (po RW-04)
etap 3:  RW-35 DOM, RW-36 most konsoli                          │
etap 4:  RW-40 worker (po etapach 1–3) ─► RW-41, RW-42, RW-43, RW-44 ─► RW-45 pomiar i decyzja
etap 5:  RW-50 delty węzłów, RW-51 koszt aktualizacji 3D w workerze, RW-52 wygaszenie trybu off
```

### Etap 0 — przygotowanie (bez zmian zachowania gry)

Korzyść bez workera: szew przestaje rosnąć, decyzja o kompozycji oparta na pomiarze, gotowa infrastruktura z testami.

**RW-01 Strażnik szwu (zapadka liczników).**
Pliki: nowe `scripts/webgpu/szewRenderu.mjs` (inwentarz z `.tmp/render-szew/inwentarz.mjs` przepisany na
`grafImportow` z `scripts/webgpu/grafGry.mjs`) i `tests/szewRenderu.test.mjs`. Liczniki z § 2 jako sufity: odwołania
`index.html` → render per grupa, importy render → `src/game` / `src/ai` (lista dozwolona per moduł docelowy z klasą
A–E), `window.<zmienna gry>` w modułach renderu (43 nazwy), DOM w modułach renderu, odczyty GPU, `Math.random`
w modułach renderu. Liczba może spaść (sufit idzie w dół), nie może wzrosnąć bez wpisu z powodem.
Kryterium: zielony na dzisiejszym drzewie; dopisek `window.ship` w module `src/3d` albo nowy import `src/game/*.js`
z renderu — czerwony. Zależności: brak. Kolizje: brak.

**RW-02 Prototyp kompozycji A / B.**
Pliki: nowe `dema/render-worker-proto.html`, `.js`, `.worker.js`, `scripts/webgpu/render-worker-proto.mjs`. Worker
z `OffscreenCanvas` i `WebGPURenderer` three r183 (scena o koszcie podobnym do gry: kilkaset instancji, post z bloomem),
wątek główny z kanwą 2D rysującą znaczniki przyklejone do ruchomych obiektów 3D i kamerę ze wstrząsem; warianty A, B1,
B2 (B3, jeśli tanio); sztuczne obciążenie wątku głównego (krok 120 Hz × S ms) i workera (D ms); numer klatki w rogu
obrazu. Sprawdza też: WebGPU w workerze Electrona 44, `transferToImageBitmap` z kanwy WebGPU, rAF w workerze.
Kryterium: raport z kryteriami 1–5 z § 3.8 dla 1080p i 4K na maszynie użytkownika + rekomendacja → decyzja D1.
Zależności: brak. Kolizje: brak.

**RW-03 Sloty renderu.** Pliki: nowe `src/render/renderIds.js`, `tests/renderIds.test.mjs` — slot + generacja dla
encji, ciał belek, pocisków i zasobów, zwalnianie po zniknięciu z list, wzrost. Bez wpięcia w grę.
Kryterium: testy. Zależności: brak. Kolizje: brak.

**RW-04 Bufory współdzielone.** Pliki: nowe `src/render/tripleBuffer.js`, `src/render/eventRing.js`,
`tests/renderBuffers.test.mjs` — potrójny bufor na `Atomics.exchange` (§ 3.2), pierścień rekordów zmiennej długości
z przejściem na większy (§ 3.3). Kryterium: testy w Node z `worker_threads` na SAB: pisarz 1000 Hz, czytelnik wolny
i nieregularny — żadnej rozdartej strony (suma kontrolna), żadnego zgubionego ani przestawionego rekordu, poprawne
przejście na większy pierścień. Zależności: brak. Kolizje: brak.

### Etap 1 — migawka i lustra na jednym wątku (tryb `inline`)

Korzyść bez workera: jawny kontrakt danych renderu (lustro bez pola = różnica w zrzucie), możliwy zysk CPU luster
(RW-11a mierzy), render testowalny na danych z tablic. Koszt: pakowanie 0,3–0,7 ms — dlatego `inline` za flagą do
czasu workera (decyzja D7).

**RW-10 Układ migawki i pakowanie.**
Pliki: nowe `src/render/snapshotLayout.js`, `src/render/snapshotPack.js` (czyste), testy; `index.html` — jedno
wywołanie w `render()` po kamerze, przed aktualizacjami 3D, za `?szew=inline`. Bloki HEAD, LISTS, ENT, BODY, NODES,
NOZZLES, SHOTS, TURRETS (na razie z rekordów `Turret2D` po `updateHexShips3D`), WORLD, CORES, HALL; reguła „zmienione
od ostatniej odebranej”; liczniki: węzły zmienione na klatkę (D — dziś niezmierzone), bajty na blok.
Kryterium: zrzuty bit w bit z flagą i bez (pakowanie nie zmienia stanu); koszt w bitwie 166 okrętów średnio ≤ 0,7 ms,
p95 ≤ 1,5 ms; raport rozmiarów bloków. Zależności: RW-03, RW-04. Kolizje: `render()` w `index.html` (kilka linii) —
miejsce uzgodnić z sesją renderu CPU.

**RW-11 Lustra i moduły 3D na lustrach** (`inline`), trzy podzadania kolejno, każde z własnym kryterium bit w bit:
- **RW-11a kadłuby i dysze** — `updateHexShips3D` / `drawHexShips3D`, `EngineVfxSystem`, lampy, cień SDF, smugi.
  Pliki: nowy `src/render/renderMirror.js`, `index.html` (listy z luster), punktowo `hexShips3D.js` /
  `engineVfxSystem.js` tam, gdzie moduł sięga po encję spoza listy (`window.ship`, `window.bullets`). Kryterium: zrzuty
  `kosmos`, `galeria`, `stacja`, `reaktor`, `warp`, `split` bit w bit; POMIAR hipotezy z § 3.6 (czas `updateHexShips3D`
  na lustrach vs na encjach, pary równoległe). Kolizje: sesja renderu CPU (`hexShips3D.js`, `engineVfxSystem.js`),
  sesja odrostu (skóra) — po ich wylądowaniu.
- **RW-11b mostki, tarcze, modele 3D, rdzenie, stacje** — `bridge3D.js`, `bridgeFx3D.js`, `shield3D.js`,
  `shipModels3DGame.js`, `reactorBlastFx.js`, `stations3D.js`. Kryterium: `stacja`, `reaktor`, `galeria`, modele
  (`scripts/webgpu/modele3d-gra.mjs`). Kolizje: małe.
- **RW-11c moduły świata** — wejścia klatki ringu, pasa, doku i ciał świata, pyłu, warpa, planet, hali jako bloki
  migawki (wzór pyłu hal; przy okazji poprawki § 3.7). Kryterium: `ziemia`, `ziemia-ring`, `mars`, `jowisz`, `pas`,
  `wydobycie`, `piraci`; `scripts/webgpu/hala-swiatla-gra.mjs`. Kolizje: blok FABUŁA (misja 2) przy doku.

**RW-12 `RenderWorld` zamiast globali gry.**
Pliki: nowy `src/render/renderWorld.js`; moduły z § 2.4 (33 zmienne, 134 odczyty: `SUN` 26, `ship` 15, `DevTuning`
12, `DevVFX` 8, `splitScreenMode` 7, `camera` 7, `__interpShipPose` 5, `OPTIONS` 5, …), `GameState` (9 odczytów
w `engineVfxSystem.js`, `warpNurt.js`); `SimClock` w workerze ustawiany z HEAD. Kryterium: zrzuty bit w bit;
strażnik RW-01: 0 odczytów `window.<zmienna gry>` w modułach przenoszonych. Zależności: RW-01.
Kolizje: wiele plików renderu, zmiany mechaniczne — po katalogach, po sesji renderu CPU.

### Etap 2 — rozkazy i rozgrywka poza modułami 3D (jeden wątek)

Korzyść bez workera: wizualia deterministyczne niezależnie od kanwy 2D i dźwięku (zrzuty A/B przestają się rozjeżdżać
po zmianach 2D), rozgrywka pasa, ringu, doku i warpa testowalna w Node i niezależna od kamery / GPU (dziś: teren ringu
płaski, dopóki kamera nie podejdzie; olbrzymy pasa bez kolizji, dopóki kadr nie dotknie pasa; automat K-7 stoi
w podzielonym ekranie; zegar warpa biegnie w scenach), opcjonalnie rakiety niezależne od fps (D2), dziennik rozkazów
do debugowania.

**RW-20 Dwa strumienie `fxRandom`.**
Pliki: `src/3d/fx/fxRandom.js` (strumień renderu), nowy strumień gry (np. `src/game/fxRandomGame.js`), `index.html`
(13 odwołań: dźwięk strzału, cząstki kanwy, wyrzut myśliwca), `src/game/hullBodies.js:2191` (parametry odłamków —
strumień renderu; w RW-22 losowanie przejdzie do workera razem z rekordem `HULL_DEBRIS`), `src/vfx/collisionSparks.js:66`, `src/game/superweapon.js`,
`src/3d/reactor3D.js:299–300` (`Math.random` → strumień renderu), `scripts/webgpu/harness-strona.js` (ziarna obu).
Kryterium: dwa przebiegi harnessu identyczne; nowa baza zrzutów zatwierdzona RAZ (sceny z efektami się zmienią —
D4); sceny bez efektów bit w bit. Zależności: brak. Kolizje: `index.html` (kilka linii), `hullBodies.js` (1 linia).

**RW-21 Strumień rozkazów — infrastruktura i broń.**
Pliki: nowy `src/render/renderCommands.js` (kody typów, pisarz, dyspozytor `inline`) + testy; źródła: słuchacz
`WeaponShotBus` → `SHOT` / `BEAM`; `index.html` (`spawnBulletImpactEffect`, `applyBulletHullPass`, `ciwsStep`,
`fireCIWSGun`, `firePointDefenseLaser`, `fireFlakSalvo`, `detonateFlakShell`, `stepSpecialCharge`, `fireWeaponCore`,
reguła `__renderedByThree` po stronie gry); `src/game/superweapon.js` (Hexlance, `slug` → id); `src/game/weaponController.js`;
`src/vfx/canvasParticleSystem.js` (`droneBlast`); `src/3d/weapons/weaponFx.js` (wejście z rekordów; efekty czytające
żywe encje — przez lustra). Kryterium: zrzuty `galeria`, `kosmos`, `rakiety` bit w bit względem bazy po RW-20;
`WeaponFx.stats` równe; testy kodowania każdego typu. Zależności: RW-04, RW-20, RW-26 (lufa i odrzut w grze).
Kolizje: `index.html` (pętla pocisków, PD) — duże pole, jedno krótkie podejście.

**RW-22 Rozkazy: kadłuby, mapa ran, iskry, odłamki, stacje, wybuchy, reaktor.**
Pliki: `index.html` (haki `HullBodies.onImpact / onRepair / onNodeLost` → `DMG_*`, `setSource / clearSource` → pole
rekordu, uv liczone w grze; `makeReactorBlow` → `EXPLOSION`; `applyDamageToStation` → `STATION_FX` po id stacji
zamiast `station._mesh3d`; `invalidateHexShipEntity3D`, `captureColdWreckImpostor` → `ENTITY_FX`),
`src/game/hullBodies.js` (`spawnHullDebris` → `HULL_DEBRIS`), `src/vfx/collisionSparks.js` (`SPARK_*`, budżet w grze),
`src/game/reactorCoreGame.js` (haki → `RX_*`, blok CORES; pęknięcia `_crackRun` liczone w grze),
`src/game/story/storyGame.js` (`api.reactorBlow`). Kryterium: zrzuty `stacja`, `reaktor`, `kosmos` (wraki), galeria
kraterów bit w bit; testy rekordów. Zależności: RW-21. Kolizje: `hullBodies.js` (sesja odrostu), `storyGame.js`
(misja 2).

**RW-23 Rakiety: symulacja do gry.**
Pliki: `src/effects3d/rocketSystem3D.js` → `src/game/rockets/rocketSim.js` (bez three: `Vector3` / `Quaternion` →
pola), adapter reżysera → `RKT_*` + blok ROCKETS, `prepareContact` po stronie gry, `Turret2D.triggerShot` z gry,
`index.html` (kierowanie ogniem, radar, `loop`). Kryterium: testy symulacji w Node (`scripts/rakiety-salwy-sym.mjs`
już dziś liczy salwy bez przeglądarki); zrzuty `rakiety` bit w bit przy niezmienionym kroku. Decyzja D2: krok lotu
w `physicsStep` 120 Hz (trafienia niezależne od fps — zmiana rozgrywki: nowa baza, porównanie trafień w
`rakiety-salwy-sym.mjs`, `rakiety-auto-gra.mjs`). Zależności: RW-21. Kolizje: `index.html` (kierowanie ogniem).

**RW-24 Suchy dok: stan po stronie gry.**
Pliki: nowy `src/game/story/pirateDryDockState.js` (stan 39 kawałków, `gone`, `live`, decyzje break / ram, plan
łańcucha — zaraz po `worldBodies.step`), `src/3d/pirateDryDockGame.js` (tylko obraz + dryf odpadłych kawałków),
`src/game/story/pirateDryDockBodies.js` (ciała z danych `buildPirateDryDockScene`, nie z obiektu 3D; prebuild bez
`Core3D.scene`), `index.html` (`spawnStoryPirateDryDock`, `onDryDockDamageStep`, `stepDryDockRam`,
`storyDryDockOpenGate`). Kryterium: `tests/pirateDryDock.test.mjs`, `tests/storyMission.test.mjs`,
`tests/worldBodies*.test.mjs`; `scripts/webgpu/suchy-dok-gra.mjs`, `zniszczenia-gra.mjs --final` bez zmiany
zachowania; pipeline'y synchroniczne 0. Zależności: RW-22. Kolizje: misja 2 (`storyGame.js`, blok FABUŁA).

**RW-25 Pas asteroid: świat pasa po stronie gry.**
Pliki: nowy `src/game/beltWorld.js` (pole, cień pól, olbrzymy z `requestNear` z kamery i statku, `collideShip`,
`pointBlocked`, `roofAbove`, `AsteroidMining` i `MiningRig` po zdarzeniu `bankRadius`, zegar skał w czasie gry, `taken`,
konsument `dirtyBox`, `playZ`), `src/3d/asteroids/asteroidBelt.js` (obraz; własna instancja pola — id skał
deterministyczne), `minedRocks.js`, `index.html` (użycia z § 2.3), SDF olbrzymów i cień pól w SAB. Kryterium:
`tests/asteroidBeltField.test.mjs` i testy wydobycia; `scripts/webgpu/asteroidy-gra.mjs --kolizja`,
`wydobycie-gra.mjs`; zrzuty `pas`, `wydobycie` bit w bit. Zależności: RW-04, RW-12. Kolizje: brak aktywnych.

**RW-26 Wieżyczki, maskowanie i jasność wieżyczek po stronie gry.**
Pliki: `src/vfx/turret2D.js` (`sync` w grze przed pakowaniem; odrzut po gnieździe strzelca zamiast szukania po
najbliższym wylocie), `updateCloakLooks` w grze (`src/game/cloakLook.js` jest czysty; z `src/3d/cloak/hullCloak.js`
zostaje obraz), lustro maski słońca dla `lightAt` po stronie gry (dyski planet z danych gry + pole pasa), 
`src/3d/hexShips3D.js` (usunięcie tych kroków), `index.html` (`render()` przed pakowaniem). Może iść przed RW-10.
Kryterium: zrzuty `kosmos`, `galeria` bit w bit, `scripts/webgpu/maskowanie-gra.mjs`; `tests/cloakLook.test.mjs`,
`tests/turretBatch3D.test.mjs`. Zależności: brak. Kolizje: `hexShips3D.js` (sesja renderu CPU).

**RW-27 Ring: świat ringu po stronie gry.**
Pliki: nowy `src/game/haloRingWorld.js` (`entries {key, planet, collider, place, service}`; teren Marsa i Jowisza
z planów CPU od razu, Ziemi z profilu z = 0 z workera; automat stanowisk K-7 bez bramki widoczności; zajętość
i lampki stanowisk; zegar migania), `src/3d/haloRing/haloRingGame.js` (obraz), `src/game/hallDustInput.js`,
`src/game/story/storyGame.js` (zajętość zamiast obiektu hali 3D), `index.html`. Kryterium:
`tests/k7BerthService.test.mjs`, `tests/hallDust.test.mjs`, `scripts/webgpu/ring-kolizje-gra.mjs`,
`hala-swiatla-gra.mjs --automat`; zrzuty `ziemia`, `ziemia-ring`, `mars`, `jowisz` bit w bit. Zależności: RW-12.
Kolizje: misja 2 (fabuła K-7) — mała.

**RW-28 Warp „Nurt”: harmonogram w czasie gry.**
Pliki: nowy `src/game/warpTraffic.js` (rejestr przylotów i odlotów, limit 24, poza z czystych `arrivalFxPose` /
`departFxPose` w kroku fizyki, `isCollidable`, `onGone`, wykrywanie `warping_in` zdarzeniem), `src/game/supportWarp.js`
(czas gry zamiast `WarpNurt.time`), `src/3d/warp/warpNurt.js` (obraz z rekordów `WARP_*`), `index.html`
(`callInSupport`, tryb LINIE, `storyWarpOut`). Kryterium: zrzuty `warp` bit w bit poza scenami fabuły (tam zegar
przestanie biec przy zamrożonym świecie — zamierzona poprawka); `tests/storyMission.test.mjs`,
`scripts/webgpu/fabula-gra.mjs --faza counter`. Zależności: RW-21. Kolizje: misja 2 (`supportWarp.js`, fale).

**RW-29 Tarcze: przebicia przez kanał zwrotny.**
Pliki: `src/3d/shield3D.js` (bity do bloku `RET`), nowy `src/game/shieldBreach.js` (test punktu na siatce płytek
z `acquireShieldLattice`), `index.html` (pociski, wiązki), rakiety. Kryterium: `node scripts/webgpu/tarcze-gra.mjs` —
przebicia jak dziś (przy D3 = bez zmian); test geometrii płytek. Zależności: RW-04. Kolizje: mało.

**RW-30 Kamera: wstrząsy po stronie gry.**
Pliki: `src/3d/weapons/weaponFx.js` (bez `camera.addShake` i `__weapon3dCameraShake`), wstrząs z danych broni
(`src/game/weaponFeel.js`) przy `SHOT` / `IMPACT`, supernowa, reaktor, warp (`src/3d/warp/player.js` → przejścia
w grze), `index.html` (kamera). Kryterium: zrzuty `warp-kop` bit w bit; wstrząs strzałów nie później niż dziś.
Zależności: RW-21. Kolizje: `render()` w `index.html` (kamera).

**RW-31 Zimne wraki i flagi w obiektach gry.**
Pliki: `src/game/coldWrecks.js` (bramka „czy widać” z kamery i progu LOD po stronie gry), `index.html`
(`coldWreckSystem`), pozostałe flagi z § 2.6 p. 17. Kryterium: testy zimnych wraków, zrzuty `kosmos` (wraki).
Zależności: RW-22. Kolizje: brak.

### Etap 3 — moduły renderu bez DOM

Korzyść bez workera: moduły renderu ładowalne w Node (testy bez przeglądarki), mniej ukrytych zależności od okna.

**RW-35 DOM i okno w modułach renderu.**
Pliki: lista § 2.9 — pomocnik `src/3d/canvas2d.js` (`OffscreenCanvas` zawsze), obrazy → `ImageBitmap`,
`TextureLoader` → `ImageBitmapLoader` (sprawdzić `flipY` tekstur planet), `requestIdleCallback` → harmonogram
z `setTimeout` / `MessageChannel`, `innerWidth / innerHeight / devicePixelRatio / screen` → HEAD (`hexShips3D.js:2212`
bez osłony!), `localStorage` (`bloomConfig.js`) → opcje rozkazem, nasłuchy (`core3d.js`, `menuBackdrop3D.js`) →
rozkazy, `pirateStationFactory.js`, `arch/ecumene.js`, `arch/fable.js`. Kryterium: strażnik RW-01 — 0 DOM w modułach
przenoszonych; zrzuty bit w bit (`mars`, `jowisz`, `piraci`). Zależności: RW-01. Kolizje: rozproszone, małe;
`core3d.js` (sesja renderu CPU).

**RW-36 Most konsoli i strojeń.**
Pliki: nowy `src/render/renderDebug.js` (RPC), podkładka `globalThis.window = globalThis` w workerze, `src/ui/devTools.js`,
`bloomTunerPanel.js`, `cameraTunerPanel.js`, konsolowe `Core3DPerf` / `Core3DPreset` / `*Tune` przez most.
Kryterium: panele F12 działają w trybach `inline` i `worker`. Zależności: RW-40. Kolizje: `src/ui/devTools.js` (małe).

### Etap 4 — worker

**RW-40 Worker renderu.** Pliki: nowe `src/render/render.worker.js`, `src/render/renderBridge.js` (tryby `off` /
`inline` / `worker`), `index.html` (`?renderWorker=1`; start kanwy wg D1). Kryterium: gra z `?renderWorker=1` przechodzi
menu, start kampanii, ODDOKUJ, bitwę 166 okrętów, podzielony ekran; brak błędów konsoli strony i workera; zrzuty jak
w `inline` (różnice tylko z kompozycji). Zależności: etapy 1–3. Kolizje: `index.html` (start, pętla).

**RW-41 Zasoby, ekran ładowania, tło menu.** Sprite'y jako `ImageBitmap`, GLB i tekstury ładowane w workerze,
`Core3D.warmup.flush` przez `postMessage`, `MenuBackdrop3D` w workerze (`launchDone`, `flightDone`, plan lotu jako
dane — `StoryGame.planMenuIntro` zwraca dziś domknięcia), zagnieżdżone workery (`hullSurface.js`, olbrzymy).
Pliki: `src/render/render.worker.js`, `src/3d/menuBackdrop3D.js`, `src/game/story/storyGame.js` (`planMenuIntro` jako dane),
`index.html` (`startGame`, `startMenuBackdrop`, `captureStorySnapshot`), `src/3d/hullSurface.js`, `src/3d/stations3D.js`.
Kryterium: `node scripts/webgpu/start-gry.mjs` — pipeline'y synchroniczne 0, start nie dłuższy niż dziś; intro kampanii
(`scripts/webgpu/fabula-gra.mjs`) bez zmian. Zależności: RW-40. Kolizje: misja 2 (intro, `storyGame.js`).

**RW-42 Kompozycja wg D1 i podzielony ekran.** Pliki: `src/render/renderBridge.js`, `src/render/render.worker.js`,
`src/3d/hexShips3D.js` (`drawHexShips3D` — kopia znika), `index.html` (kanwy `#webgl-layer` / `#c`, `render()`).
Kryterium: kryteria 1–5 z § 3.8 zmierzone w grze, zrzuty sesji `split`. Zależności: RW-02, RW-40. Kolizje: `render()`.

**RW-43 Nakładki 2D wg kompozycji.** A: wieżyczki i myśliwce do workera (partie / kwady — `src/vfx/turret2D.js`,
`src/vfx/fighterSprite.js`, nowa partia w `src/3d/`), pierścień kamer dla ramek (`src/ui/radar/scanOverlay.js`, nakładki
RTS w `index.html`); B2: warstwy buforowane w `render()`, rysunki kursora (`src/ui/weaponReticle.js`, koło trybów, menu
PPM) przy składaniu, znaczniki DOM (`src/ui/storyOverlay.js`) z klatki k; w obu: leniwa budowa kadłubów NPC wyjęta
z `drawNPCPretty` do logiki gry. Kryterium: kryterium 4 z § 3.8 w grze (rozjazd znaczników) i zrzuty.
Zależności: RW-42. Kolizje: `render()` w `index.html` (nakładki), `src/ui/*`.

**RW-44 Harness.** Cel workera w CDP (`Target.setAutoAttach` + `Runtime.evaluate` w workerze), fasada `window.Core3D`
na wątku głównym (gotowość i pomiary z `RET`), bariera „narysowano k”, ziarna strumieni efektów do workera; przegląd
56 skryptów wg § 2.8 (55 gotowość → fasada, 21 pomiary → `RET` / RPC, 12 sterowanie → rozkazy / RPC, 16 introspekcja →
ewaluacja w workerze). Kryterium: `zrzuty.mjs` w trybie `worker` daje te same obrazy co w `inline` (poza kompozycją);
pozostałe skrypty uruchamiają się w obu trybach. Zależności: RW-40.

**RW-45 Pomiar końcowy i tryb domyślny.** `profil-bitwy-flot.mjs` przy zoomie 0,1 i 0,45, pary równoległe; cel
≥ 1,6× fps przy 0,1 (szacunek ~2×), p95 klatki nie gorsze; `zasiegi-gra.mjs`, `fabula-gra.mjs`, `pad-gra.mjs`
przechodzą. Pliki: tylko domyślna flaga w `src/render/renderBridge.js` i wpis w `AGENTS.md`. Decyzja D8 (domyślny
tryb). Zależności: RW-40…RW-44.

### Etap 5 — po pomiarze

- **RW-50** delty węzłów przez pierścień zamiast pełnych kopii zmienionych ciał, uśpione ciała i wersje (gdy RW-10
  pokaże, że NODES dominuje).
- **RW-51** koszt aktualizacji 3D w workerze (`updateHexShips3D` 4,7–6,7 ms przy zoomie 0,1 to nowe wąskie gardło).
- **RW-52** wygaszenie trybu `off` po okresie z `inline` / `worker`.

## 5. Decyzje do podjęcia

| # | decyzja | kiedy | propozycja |
|---|---|---|---|
| D1 | kompozycja A czy B2 | po RW-02 | B2, jeśli koszt składania ≤ 0,2 ms — zachowuje „3D i 2D z jednej klatki” bez przenoszenia wieżyczek i myśliwców |
| D2 | lot rakiet w kroku 120 Hz (dziś w klatce rAF — trafienia zależą od fps) | RW-23 | tak, osobnym krokiem po przeniesieniu bez zmiany zachowania |
| D3 | przebicia tarcz liczone tylko dla tarcz na ekranie ≥ 9 px (dziś tak — rozgrywka zależy od kamery i mgły) | RW-29 | zostawić jak dziś w ramach planu; zmiana zasady osobno |
| D4 | jednorazowa nowa baza zrzutów po rozdziale `fxRandom` i przeniesieniu `Math.random` z `reactor3D.js` | RW-20 | tak |
| D5 | wieżyczki 2D w kompozycji A — partie wież 3D czy kwady z atlasem 2D w scenie (zmieni się też kolejność warstw: dziś wieżyczki są nad warstwą FG) | RW-43 (tylko A) | kwady z atlasem 2D — wygląd jak dziś |
| D6 | myśliwce w kompozycji A — do sceny 3D czy 2D z rozjazdem | RW-43 (tylko A) | do sceny (kwady) |
| D7 | tryb `inline` jako domyślny przed workerem | po RW-11a | domyślnie `off`, chyba że lustra okażą się szybsze |
| D8 | domyślny tryb po etapie 4 | RW-45 | `worker`, z `inline` jako zapasem |

## 6. Odtworzenie inwentarza

Skrypty leżą w `.tmp/render-szew/` (poza gitem — `.tmp/` jest w `.gitignore`; RW-01 przenosi inwentarz do
`scripts/webgpu/szewRenderu.mjs`). Kolejno:

```bash
node .tmp/render-szew/inwentarz.mjs
```

```bash
node .tmp/render-szew/grupy.mjs
```

```bash
node .tmp/render-szew/fragmenty.mjs
```

`inwentarz.mjs` parsuje główny skrypt `index.html` i `src/` (`rollup/parseAst`), buduje graf plików gry od
`index.html` (statyczne, dynamiczne, workery; dema pominięte), graf jednostek skryptu (osiągalność od `render`
i `physicsStep`), uchwyty z fabryk renderu, `window.*` czytane w renderze z pisarzami, odczyty GPU, skrypty harnessu
i DOM → `wynik.json`, `wynik.md`; `grupy.mjs` przypisuje grupy (reguły + jawne wyjątki dla jednostek wołanych przez
`window.*`, których graf wywołań nie widzi) → `grupy.json`, `grupy.md`. Opisy modułów (§ 2.3, 2.5–2.7) powstały
z czytania kodu (pięć równoległych przeglądów, 2026-10-07) — przy zmianach modułów sprawdzać po nazwach funkcji.
