# PLAN: ruch v2 w grze — porty, budowle, kontenery, worker (2026-09-26)

> Wspólny punkt odniesienia dla sesji, które równolegle wdrażają ruch v2 (`src/game/traffic/`)
> do gry. **Wszystkie sesje pracują w TYM SAMYM drzewie roboczym** (bez worktree) — trzymaj się
> swoich plików (tabela w § 4), zanim edytujesz wspólny plik, przeczytaj go ponownie. Stan zadań
> dopisuj w § 7 (jedna linijka na zadanie).

## 1. Decyzje użytkownika (2026-09-26)

1. **Skala gospodarki ×60** — więcej żywego ruchu; krok wstecz zawsze możliwy.
2. **Równy rozkład stanowisk** między doki portu — ruch ma być widać w całym porcie, nie w jednej hali.
3. **K-7 = wojsko.** Hale K-7 mieszczą flotę frakcji; gracz wchodzi do hal wojskowych przy wysokiej
   reputacji (próg „Sojusznik”, ≥ 50 w `REPUTATION_TIERS`, `src/data/factions.js`) i może tam
   kupować okręty. **Zatoki = terminale przeładunkowe** (cały ruch cywilny).
4. **Bezczynne statki:** reda (strefy postoju w przestrzeni) w dużych portach; **hangary postojowe**
   tam, gdzie ruch mniejszy, i przy stacjach bez ringu.
5. **Kontenery:** towar wożony w kontenerach stackowanych na statkach; w porcie **drony 3D**
   rozładowują i ładują.
6. **Symulacja ruchu w Web Workerze.**
7. **Unia Pasa** bazuje w **bazach asteroidowych**.
8. **Ringi:** Ziemia i Mars mają ring „Halo”; **Jowisz też dostaje ring**. **Ringi Marsa i Jowisza
   oraz ich doki mają wyglądać inaczej niż Ziemia.** Pozostałe planety (Merkury, Wenus, Saturn,
   Uran, Neptun) dostają **ogromne doki / stacje** (megadoki), każda z własnym charakterem.

## 2. Liczby (pomiar `scripts/pomiar-portu-x60.mjs`, ×60, magazyny ×4, presja 1, 6 h, od 60. min)

Port Ziemi, 224 stanowiska (4 kompleksy × [K-7 + 2 zatoki]):
- zajęte śr. 42 / p95 68 / max 118, kolejka 0; 1 764 cumowań/h; postój przy stanowisku śr. 86 s
  (`LOAD_SECONDS` 90 / `UNLOAD_SECONDS` 120 w `trafficDirector.js`);
- **same zatoki (112 stanowisk) wystarczą:** kolejka śr. 0,15 / max 27 → K-7 może przejść do wojska;
- 56 stanowisk to za mało (kolejka śr. 12–101);
- w pobliżu gracza: ≤ 60 tys. j. od Ziemi 38 statków w ruchu (max 103) + 22 przy stanowiskach;
  ≤ 15 tys. od hali gracza śr. 8 (max 26);
- tick dyspozytora (5 s gry): śr. 18 ms, p95 43, max 78 → worker.

Porty bez ringu (dziś „teoretyczne” pomosty `buildStationDocks`):

| port | stanowisk | cumowań/h | zajęte śr. / max | kolejka śr. / max | parking p95 / max |
|---|---|---|---|---|---|
| Merkury | 104 | 788 | 15 / 79 | 0,07 / 8 | 69 / 78 |
| Wenus | 78 | 1 177 | 26 / 78 | 0,26 / 38 | 34 / 93 |
| Jowisz | 52 | 1 354 | 35 / 52 | **5,9 / 41** | 183 / 266 |
| Saturn | 26 | 866 | 18 / 26 | **20,8 / 166** | 419 / 472 |
| Uran | 26 | 759 | 16 / 26 | 3,6 / 59 | 241 / 336 |
| Ceres | 52 | 783 | 17 / 52 | 0,87 / 60 | 190 / 317 |
| Westa | 52 | 841 | 14 / 52 | 5,7 / 61 | 88 / 123 |

Neptun jest opuszczony (bez doków). Rozmiar portu bez kolejki ≈ 3 × (cumowań/h × 86 s / 3600);
proporcje klas z cumowań (np. Jowisz: S 18%, M 51%, L 21%, capital 6%, mega 5%, min. 8
stanowisk capital i mega). Parking Ziemi: śr. 260 / p95 387 / max 408 (vany i haulery).
Zapas okrętów frakcji po 6 h: Terra Nova ~60, Mars 155–300, Konsorcjum Zewnętrzne ~230,
Unia Pasa ~200 — nadmiar ponad hale wojskowe stoi na redzie wojskowej.

## 3. Architektura docelowa

### 3.1 Trzy warstwy statków
- **Rekord** (worker) — kurs, etap, stanowisko; jedyne źródło prawdy ekonomii.
- **Proxy w bańce** (główny wątek, POZA `npcs[]`) — lot kinematyczny (`materializedFlight`
  rozszerzony o ścieżki portu i ring), render instancjonowanym batchem sprite'ów, dysze z pul.
  Koszt rzędu µs na statek. Tu żyje ~40–100 statków w ruchu i ~20–40 przy stanowiskach.
- **Pełne NPC** — awans przy walce albo interakcji (`makeNPCBase` + kadłub belkowy), maks. ~1
  awans na klatkę (budowa kadłuba); degradacja z powrotem, gdy nieuszkodzony i poza zainteresowaniem.
  Uwaga: dziś NPC poza misją giną > 20 tys. j. od gracza — proxy/awansowane potrzebują flagi.

### 3.2 Worker (`TrafficBridge`)
Rdzeń ruchu nie używa żadnego API przeglądarki (sprawdzone) — może żyć w workerze w całości
(`getEconomy`/`onWreck`/WeakMap zostają w środku). Wzór: `PhysicsBridge`
(`new Worker(new URL(...), { type: 'module' })`, fallback na główny wątek). Protokół (szkic):
- gra → worker: `init` (kąty planet, pozycja Słońca, stacje, zapasy, skala, ziarno), `advance {dt}`
  co klatkę (pauza = brak wiadomości), `focus {x, y, r}` ~10 Hz, `trade`, `stockDelta`, `capacity`,
  `attach/detach/destroyed {courseId}`, `stationState`, `berthHold/berthRelease` (gracz);
- worker → gra: `tick` (bufor kursów w bańce: Float64Array, stride ~9: x0, y0, x1, y1, t0, dur,
  flagi, kadłub, frakcja), `market` (Float32Array stacje × surowce × [zapas, poj., bid, ask] co cykl),
  `ports` (zajętość stanowisk w bańce), `wreck` (z `onWreck`), dostawy.
Czas ruchu = czas gry 1:1 (gra nie ma przyspieszenia; `TIME_SCALE` 60 to tylko zegar na ekranie).

### 3.3 Port
- stanowisko ma rolę `civil` (zatoki, pomosty megadoków) albo `military` (K-7); kursy cywilne
  tylko na `civil`, flota frakcji na `military`;
- przydział **równy** (po dokach na przemian / najmniej zajęty dok), best-fit klasy zostaje;
- **reda**: strefy poza ringiem między kompleksem a tranzytem (Ziemia: sektor ±18°…±43° od środka
  kompleksu, r ≈ 48–58 tys. j.), boje w 3D, statki jako statyczny batch; **hangar postojowy**:
  pojemność abstrakcyjna (statek wlatuje i znika z renderu) — porty o małym ruchu i bez ringu;
- terminal handlu gracza przenosi się z hali K-7 nr 1 do zatoki (dziś `HALO_PORT_STATION`
  w `src/game/haloRingPlanets.js`).

### 3.4 Kontenery i drony
Kontener to WIDOK liczby — nigdy nie wpływa na ekonomię. Rodziny: standard (drobnica, `szt`
albo ≥ 40 CR/t), zbiornik (gazy, paliwo), zsyp (ruda, lód, złom, stal); pole `form` w
`resources.js`. Liczba = `ceil(slots × masa / ładownia)`; sloty: van 8, hauler 18, bulk 28,
heavy 14 modułów, mega ~20. Transfer liczony wprost z (ziarno kursu, czas postoju) — bez stanu.
Render jak model mostka (`bridge3D.js`): InstancedMesh w warstwie 0, początek przy kamerze,
cień kwadem z `depthFunc GREATER`, paralaksa orto-kadłub / perspektywa-port. **Sprite'y
frachtowców mają domalowany ładunek** → potrzebne wersje „pusty pokład” (§ 5, Z11).

## 4. Zadania

Faza 1 = można zaczynać od razu (równolegle). Faza 2 = po zależnościach.
„Pliki” = właściciel; cudzych nie ruszać bez uzgodnienia z użytkownikiem.

| ID | zadanie | faza | zależy od | pliki (właściciel) | index.html |
|---|---|---|---|---|---|
| Z1 | Worker ruchu v2 + most do gry | 1 (A), 2 (B) | — | nowe `src/game/traffic/trafficWorld.js`, `trafficCore.js`, `traffic.worker.js`, `src/game/trafficBridge.js`; `travelNetwork.js`, eksporty w `trafficDirector.js`, `scripts/symulacja-ruchu.mjs`, `ruch-v2.html` | faza B, za `?trafficV2` |
| Z2 | Port v2 — logika (role, równy rozkład, obrót Marsa, reda/hangar, stanowiska wojskowe) | 1 | — | `dockLayout.js`, `portControl.js`, `src/3d/haloRing/haloPortTraffic.js`, nowy `src/game/traffic/portParking.js` | nie |
| Z3 | Bańka — lot lekki i ścieżki portu | 1 | — | `materializedFlight.js`, nowe `src/game/traffic/portPaths.js`, `ringRouter.js` | nie |
| Z4 | Bańka — render proxy + rejestr kadłubów ruchu | 1 | — | nowy `src/3d/shipProxyBatch3D.js`, nowy `src/data/trafficHulls.js`, profile w `src/data/ships.js`, mały eksport w `hexShips3D.js` | nie |
| Z5 | Kontenery i drony 3D (demo) | 1 | — | nowe `src/data/cargoContainers.js`, `src/game/cargoPortOps.js`, `src/3d/cargoContainers3D.js`, `src/3d/cargoDrones3D.js`, pole `form` w `resources.js`, demo w `dema/` | nie |
| Z6 | Ringi Marsa i Jowisza: własny wygląd ringów i doków + ring Jowisza | 1 | — | `src/3d/haloRing/*` (profile planet), `HALO_RING_PLANETS` w `haloRingPlanets.js`, `ringScale.js` | tylko jeśli konieczne |
| Z7 | Budowle portowe jako moduły: stocznia (pochylnie + suchy dok), hangar postojowy, boje redy | 1 (moduły), 2 (na ringach po Z6) | Z6 do wpięcia w ring | nowe moduły w `src/3d/` + demo; wpięcie w miejsca ringu dopiero po Z6 | nie |
| Z8 | Megadoki dla planet bez ringu | 1 | Z7 (moduły hangaru/stoczni — wpiąć, gdy gotowe) | nowe moduły megadoku, `stations3D.js` (podmiana GLB), układy w formacie `buildStationDocks` | tylko jeśli konieczne |
| Z9 | Bazy asteroidowe Unii Pasa (Ceres, Westa) | 1 | — | nowe moduły bazy; kod wielkich asteroid (`asteroidGiants.js`, `rocks/giantRock3D.js`) — uzgodnić z przebudową asteroid | tak (stacje Ceres/Westa) |
| Z10 | K-7 wojskowe — gameplay (reputacja, kupno okrętów, terminal w zatoce) | 1 | — | `playerHullMarket.js`, `src/ui/*` (tablet stacji), `HALO_PORT_STATION` w `haloRingPlanets.js`, `haloPortDocking.js` (odmowa) | tak (handel/rynek kadłubów) |
| Z11 | Sprite'y — prompty do generatora | 1 | — | nowe `assets/ships/*.prompt.md` | nie |
| Z12 | Błąd: NPC nie są ograniczane przez ring ani asteroidy (`pos` vs `x`) | 1 | — | `haloRingCollision.js`, pętle kolizji NPC w `index.html`, testy | tak (małe) |
| Z13 | Bańka w grze: wpięcie, awans do NPC, wraki, dokowanie gracza przez kontrolę portu, koniec starych vanów, dźwigi K-7 dla NPC | 2 | Z1, Z2, Z3, Z4 | `index.html` za `?trafficV2`, nowy `src/game/trafficBubble.js` | tak |
| Z14 | Kontenery i drony w bańce | 2 | Z5, Z13 | moduły Z5 + hak w bańce | mały |
| Z15 | Reszta braków: model bramy skoku, 2 gniazda piratów, stacje tankowania, księżyce (po decyzji) | później | — | — | — |

## 5. Sprite'y (dla generatora, Z11)
- **Nowe role:** `heavy_freighter` (dziś zastępczy), Corvus (dziś sprite Custosa), kuter policji/celników,
  łowca nagród, statek ratunkowy.
- **Rodziny frakcyjne** (dziś wszystkie latają kadłubami Terra Novy): Mars, Konsorcjum Wewnętrzne,
  Unia Pasa, Konsorcjum Zewnętrzne × fregata, niszczyciel, krążownik, nosiciel — najpierw fregata
  i niszczyciel (84% budowanych kadłubów).
- **Puste pokłady** frachtowców pod kontenery 3D: prom, kontenerowiec, frachtowiec dalekiego
  zasięgu, ciężki frachtowiec, megafrachtowiec (+ wagon).
- **Gotowe, niepodpięte** (tylko rejestracja, Z4): `heavy_harvester`, `belter`, `surveyor`,
  `refinery_tender`, `tanker`, `salvage_hauler`, `construction_tug`, `pirate_raider`, `smuggler`,
  `repair_drone`, `distress_beacon_ship`, `megafreighter.png`.

## 6. Zasady dla sesji
- **Wspólne drzewo.** Commit tylko własnych hunków (`git diff` → `git apply --cached`) i tylko na
  prośbę użytkownika. Cudza praca w toku potrafi chwilowo psuć testy — nie „naprawiaj” jej.
- **Testy:** `npm test` (= `scripts/tests/*`), `node --test tests/*.test.mjs` (8 znanych porażek
  na czystym stanie — sprawdź przed zmianą). `npm run build` pada na brakującym `AISPACE.html` —
  build gry przez tymczasowy config w scratchpadzie (`input: ['index.html']`). Gameplay testuje
  użytkownik; zrzuty tylko przez headless harness (`dema/rdzen-cdp.js`).
- **Render:** tylko przez `Core3D` (bez nowych rendererów), pozycje świata względem
  `sceneOriginNearCamera`, emitery HDR > 1, AGENTS.md. Nowe budowle najpierw w demie, potem w grze.
- **Ring nie udaje życia:** żadnych zastępczych statków ani ruchu — statki przychodzą z ruchu v2.
- **Pomiar portu** po każdej zmianie składu stanowisk: `node scripts/pomiar-portu-x60.mjs 360 1 4 60`
  (`WATCH=…`, `DROP=…`, `SPREAD=1`, `SEED=7`).

## 7. Stan
- 2026-09-26: plan spisany; błąd id floty (`addShip`) naprawiony w osobnej sesji.
- 2026-09-26 Z12: zrobione (bez commita) — NPC do kolizji z ringiem i asteroidami przez widok kinematyki
  x/y/vx/vy (`src/game/npcCollisionBody.js`, `AsteroidField.checkShipBodyCollisions`); poza kolizją:
  skok tranzytu (`phase 'warping'`), `isCollidable === false`, dok, wagony megafrachtowca; testy
  `tests/npcWorldCollisions.test.mjs`. Uwaga Z3/Z13: pełne NPC przy Ziemi/Marsie czują płytę — trasy muszą ją omijać.
- 2026-09-26 Z1: zrobione (większość w commitach „update”, reszta bez commita). Faza A: `trafficWorld.js` (jeden
  builder + krok; skrypt i demo przełączone; `SEED=7 … 240 1 4 60` identyczny z przedrefaktorowym na tej samej
  migawce; Ziemia/Mars domyślnie na porcie K-7 z `buildHaloPortTrafficLayout`, `K7=0` = stare pomosty),
  `travelNetwork` (`origin`, `planetAngles`, `sunRadius`), `trafficDirector` (jedno ziarniste `rng`, `destroyCourse`,
  `applyStockDelta`, `setCapacity`, `stationDestroyed`, `protectObserved`), `trafficProtocol.js`, `trafficCore.js`,
  `traffic.worker.js`, `src/game/trafficBridge.js` (worker, przesiadka na główny wątek przed `ready`, kopia rynku
  z uzgadnianiem numerów zmian), testy `scripts/tests/traffic{World,Core}` i `tests/trafficBridge`. Faza B pod
  `?trafficV2[=skala]` (`&trafficSeed=N`): start z planet/stacji gry, `advance` z krokami fizyki, stara ekonomia
  i vany stoją, terminal i rozbiórka wraku na kopii rynku, jedna cena `resourcePrice` + reputacja, pojemności
  budynków przez most, PerfHUD „Ruch v2 (most)”; sprawdzone w headless Chrome (worker i tryb awaryjny). Dla Z13:
  bufor kursów (`COURSE_FIELD`, `coursePosition`, `courseHull`, `courseBerth` = id padu jak w układach gry),
  `attach/detach/progress/stage-done/destroyed`, zdarzenia `wrecks`/`war-wrecks`; `TRAFFIC_V2_BUBBLE_RADIUS` 60 tys.
  Do decyzji: pojemność = baza × 4 + premie budynków (× skala); cena gracza pod flagą z rozstępem 12% zamiast ±18%.
  Nie zrobione: `berth-hold` gracza (Z13 + API portu Z2), rola w `estimateWait` (gdy kursy wojskowe zaczną cumować).
- 2026-09-26 Z3: zrobione (część w commitach „update”, reszta bez commita). `ringRouter.js`: strefy ringu
  (płyty portu +7 j., poza nimi teren), objazd planety łukiem `keepR` ≈ 60 tys. (Ziemia; nad redą Z2 do 58,5),
  w strefie portu tylko promieniowo, płyta tylko przez 4 tranzyty; `createRingObstaclesForNetwork`.
  `portPaths.js`: ścieżki K-7 (pas capital, banki przez G-02/G-03) i zatok (pas MEGA, grzebień), pomosty ogólnie;
  punkt czekania przed ujściem korytarza, wyjście tyłem (grzebień → aleja, pas → za bramę) i w bok od osi.
  `materializedFlight.js` (API bez zmian + `createBubble({ rings, docks, holdPose, records })`, `getActorList`,
  `actorRenderPose`, `ACTOR_PHASE`): lot po ścieżce, kurs przy stanowisku ze stanowiska (`berthId`, zapasowo
  `berthRef`), przechwyt w oknie `PortDocking` + 1,1 s pozy, odłączenie `PORT_SEQUENCE`, kolejka dziobem od
  planety, korytarze bez cykli czekania, separacja na tablicach typowanych, `prevX/prevY/prevAngle`, `vx/vy`,
  `throttle`, `dockTime`. Testy: `ringRouter`, `portPaths` (60 pełnych cykli Ziemia + Mars bez ścian i płyty,
  przechwyt ≤ 3% okna, ≤ 0,7°), `materializedFlight` (świat ×60 12 min: 0 zamrożeń, 0 osieroconych przypięć;
  200 encji ~0,4 µs/encję/krok; świat ×60 ~7 µs z przeglądem ~900 rekordów). Uwagi Z13: rekord w bańce potrzebuje
  `berthId` (z `BERTH` protokołu → `docks.berths[i].id`) i rodzaju NASTĘPNEGO etapu (inaczej koniec przelotu =
  stop); `records` = attach/detach/progress/stage-done protokołu; `holdPose` = reda, gdy kolejka na nią przejdzie.
- 2026-09-26 Z11: zrobione (bez commita) — 27 promptów w `assets/ships/*.prompt.md` (5 ról, 4 frakcje × fregata,
  niszczyciel, krążownik, nosiciel, 6 pustych pokładów) + `assets/ships/README.md` (lista, proporcje, priorytety,
  siatki slotów, checklista po wygenerowaniu); PNG generuje użytkownik. Uwaga Z5: ciężki frachtowiec dostaje
  3 × 8 zatok (nie „heavy 14”). Do decyzji: krążowniki i nosiciele frakcji w obwiedniach profilu mają 0,4–0,7 pola
  Bellatora i Citadelli (HP, masa zderzeń).
- 2026-09-26 Z2: zrobione (w commicie „update” + drobne poprawki bez commita). Role stanowisk (`BERTH_ROLE`: K-7
  `military`, zatoki i pomosty `civil`; `berthRoleForCourse` = WAR/PATROL albo `course.berthRole`; port bez hal
  wpuszcza okręt na cywilne; FIFO kolejki osobno na rolę); stanowiska niosą limity padów (`maxLength/maxBeam` —
  fregata na S hali); `findBerth` przy remisie kosztu bierze najmniej obłożony dok (+ rotacja, `spread: false` = stary
  dobór); `buildHaloPortTrafficLayout(…, { rotation })`, domyślnie z `haloRingRotation` (Mars −π — był 180° obok)
  i `layout.ring` (kąty kompleksów/tranzytów w grze). Nowy `portParking.js`: reda cywilna od strony kompleksu,
  wojskowa od strony tranzytu, obie zapełniane od środka sektora (podejścia do zatok i wylot tranzytu wolne)
  (Ziemia r 48–58,5 tys., 1192 + 728 slotów w standardzie padów K-7), hangar dla portów
  bez ringu i przy `expectedParked ≤ 60`, stabilny rejestr `syncParking`, zapas okrętów `placeFleetStock` (pady K-7,
  1 capital na halę wolny, nadmiar na redzie wojskowej). Pomiar ×60, A/B na 3 ziarnach: kolejka Ziemi śr. 0,02–0,14
  / max 13–27 (jak same zatoki), kompleksy 10,0/9,7/9,7/9,4 z 28 (było 18,9/10,8/6,3/3,0), dostawy w szumie; na żywej
  flocie reda Ziemi max 400, Marsa 330, bez przelewu, 0 przestawień, sync ~50 µs. Uwagi: Z1 — `estimateWait(…,
  { role })`, gdy kursy wojskowe zaczną cumować; `ruch-v2.html` może rysować postój z `portParking`. Z3/Z13 — rejestr
  postoju trzymać między tickami (to on daje stabilność), okręty z `placeFleetStock`; `SPREAD=1` w pomiarze zbędne.
