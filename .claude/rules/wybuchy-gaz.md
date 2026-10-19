---
paths:
  - "src/3d/explosions/**"
  - "src/3d/gas/**"
  - "src/game/explosionEvents.js"
  - "src/game/fuelTank.js"
  - "src/data/fuelTanks.js"
  - "src/game/crushSmoke.js"
  - "src/game/gasObstacleInput.js"
  - "src/3d/tsl/zapisF16.js"
  - "dema/wybuchy-webgpu.html"
---

# Wybuchy WebGPU i gaz 3D: receptury, domeny, przeszkody, zbiorniki paliwa, dym zgniotu

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Pliki obszaru (z mapy repozytorium)

- **`src/3d/explosions/`, `src/3d/gas/`** — wybuchy WebGPU (`window.makeReactorBlow`): kula ognia i dym z gazu na siatce 3D w compute, strumienie gazu z miejsca wybuchu, żar, pule gry, światła w siatce, fala jako sama refrakcja. Opis: § „Wybuchy WebGPU”.

## Dym i ogniska wraków (wypięte z gry) — z sekcji „Kadłuby na belkach”

- **Wybuchy na gazie — W GRZE od 2026-10-07** (§ „Wybuchy WebGPU”: kula ognia, strumienie gazu, dym, który się rozchodzi i znika — progi i łańcuch rozpadu doku, rozpad stacji, śmierć bez rdzenia). **Dym i ogniska WRAKÓW — dalej NIE w grze** (2026-10-05, § 12 planu zniszczeń; decyzja użytkownika: silnik zniszczeń BEZ dymu i ognia na ciałach): gotowy klej `src/3d/gas/gasSmokeGame.js` (`createGasSmokeGame(Core3D)` → `window.GasSmoke`: krok `Core3D.addFxStep`, płaskie domeny 48 × 48 × 24, obłok POD płaszczyzną gry — A/B: gęsty dym nad nią chował wrak; zdarzenia `shipWrecked` / `shipDetonated` / `stationDestroyed` / `stationHit`, kurz z `CollisionFX`) jest wypięty z `index.html`; wpięcie i lekcje strojenia — plan § 12. Testy `tests/gasSmokeGame.test.mjs`, `tests/gasGrid.test.mjs`; `scripts/webgpu/dym-gra.mjs` działa dopiero po ponownym wpięciu.

- Wybuchy i dym zniszczeń — warsztat (2026-10-05, § 12 planu zniszczeń; dema WebGPU): gaz na siatce 3D w compute jak Niagara Fluids (`src/3d/gas/`: `gasGrid.js` — domeny w atlasie `Storage3DTexture`, dane w komórkach domeny, MacCormack, spalanie paliwa, rozprężanie, Jacobi; `gasVolume.js` — marsz promienia z emisją Kirchhoffa i samocieniem; `gasExplosions.js` — przepisy wybuchów budowli; `destructionGasFx.js` — zdarzenia silnika belek i broni fizycznych → efekty; `PhysicalWeapons3D.detonate` — front ciśnienia bez pocisku), renderer ciał belkowych w TSL (`beamShips3D.webgpu.js`). Demo `destruktor3d-webgpu.html` (GENEROWANE z `destruktor3d.html`: `python scripts/destruktor3d-webgpu-gen.py`) na kleju dem `gasSceneFx.js`; `dema/wybuchy-webgpu.html` od 2026-10-07 pokazuje wybuchy GRY na Core3D (§ „Wybuchy WebGPU”). Gra wpina gaz przez `Core3D.addFxStep` i siatkę świateł (`src/3d/explosions/`), nie przez klej dem.

## Wybuchy WebGPU (`src/3d/explosions/`, gaz `src/3d/gas/`; 2026-10-07, etapy A–E2 i D audytu `docs/AUDYT-wybuchy-gaz-2026-10-08.md` — 2026-10-09)

- Wejście z GRY (RW-22): `GameBlasts.blast(o, drony)` (`src/game/explosionEvents.js` — rekord `EXPLOSION`, dekoder `src/3d/explosions/explosionCommands.js` woła fabrykę bez opakowania; `drony = true` — gra zmiata drony naprawcze w zasięgu, jak dawne `withRepairDroneBlast`), opcje jak niżej; render (rozpad stacji — Destruction3D) i konsola wołają dalej fabrykę: `window.makeReactorBlow({ x, y, size, profile, vx?, vy?, axisX?, axisY?, jetVelTau?, tint?, gasOnly?, hostKey? })` (świat gry,
  `size` — Atlas ≈ 280): progi punktów i łańcuch rozpadu suchego doku, rozpad stacji (`Destruction3D.init({ reactorFactory })`),
  skrypty. Fabryka `createExplosionFactory(Core3D, { rocketFx, weaponFx })` przy starcie efektów w `index.html`, reżyser
  `window.__explosions`. ŚMIERĆ OKRĘTU bez detonacji rdzenia (pula HP NPC, gracz bez rdzenia) = wybuch z MIEJSCA ZBIORNIKA
  PALIWA (`src/data/fuelTanks.js` — Atlas, Bellator, Iron Skull, reszta z automatu: głęboko w części rufowej, poza komorą
  reaktora; edytor `ships[alias].fuelTanks` bierze górę; `src/game/fuelTank.js`, montaż w `attachEntityReactorCores` po rdzeniu):
  `fuelTankBlast` PRZED `createWreckage`, profil escort / cruiser / capital z długości kadłuba, size ∝ √pojemności, nośnik =
  prędkość wraku, strumienie wzdłuż osi kadłuba (`axisX / axisY`, `jetVelTau`), `hostKey` = ród `dmgKey` (wrak nie jest przeszkodą
  swojego gazu). Detonacja rdzenia (`src/3d/reactorBlast/`) dokłada domenę `gasOnly` z dymem w barwie plazmy frakcji (`tint`).
  Myśliwce i platformy — `WeaponFx.droneBlast`. Wybuchy okrętów przez `shipBlastFactory` (bez ran dronów naprawczych); A/B
  `window.ShipBlastTune`. Nowa ścieżka śmierci okrętu — przez zbiornik, nie wybuch w środku kadłuba.

- PĘKNIĘCIE ZBIORNIKA za życia okrętu (2026-10-15, prośba użytkownika: „wybuchy dymu przy taranowaniu, jeśli rozwalę fuel
  tank”): `stepFuelTankRupture` (`fuelTank.js`) w kroku integralności (`updateHardpointIntegrity` → `stepEntityFuelTankRupture`,
  gracz i okręty, PRZED sufitem punktów) — martwych ≥ `FUEL_TANK_TUNE.ruptureDeadFrac` (0,5) komórek zbiornika (taran, zgniot,
  krater, rozpad; komórki odcięte z odłamem, żywe na wraku rodu, są całe) → wybuch zbiornika OD RAZU, raz na zbiornik (sam
  obraz, bez obrażeń); sprawdzenie tylko po zmianie liczby żywych węzłów. Potem `fuelTankBlast` → null, a śmierć
  (`spawnShipDeathBlast`): do `ruptureQuiet` (1,5 s) bez drugiego wybuchu, później wybuch resztek ze środka × `afterRuptureSize`
  (0,6). Remont (dok, odrost dronów) — zbiornik znów cały. Pomiar `node scripts/zbiornik-taran-sym.mjs` (Node, Atlas,
  6 kadłubów × 7 stron × 3 prędkości): zbiornik pęka w ~40% taranów (pancernik szarżą 10/14, W + Shift z 600 j/s 2/14), dym
  przy taranie 57% zamiast 35% (dawniej tylko przy śmierci; pancernik nie ginie od taranu), kula pod Atlasem (przeszkoda gazu)
  mediana ~30%. W grze (`node scripts/webgpu/zbiornik-gra.mjs --tryb taran`, A/B `ShipBlastTune.rupture`): szarża w rufę
  pancernika TN — pęknięcie po 0,35 s, w burtę pancernika piratów — po 0,42 s (oba żyją; dawniej 0 wybuchów), pipeline'y
  w klatce 0; bitwa 40 × 40 (`--tryb bitwa`): od broni 3 pęknięcia na ~57 zatopionych — w walce prawie bez zmian. Liczniki
  `window.FuelTankRuptureStats`; testy `tests/fuelTank.test.mjs`.

- DYM ZGNIOTU kadłuba w taranie (2026-10-15, prośba użytkownika: „mniejszy dym przy ciężkim zgniocie kadłuba (taran bez
  trafienia w zbiornik), żeby szarża prawie zawsze dymiła”; `src/game/crushSmoke.js`, klej w bloku zbiornika `index.html`):
  okręt (encja ze zbiornikiem — nie wrak, myśliwiec ani budowla), który W STYKU kadłubów (`CollisionFX` grind / impact)
  traci w 0,25 s ≥ 30% węzłów kadłuba (8–24; straty poza bronią z haka `HullBodies.onNodeLost` → `noteHullNodeLost`, który
  woła też rozdarcia mapy ran), dostaje przy zgniocie wybuch z gazu profilu `crush` (`explosionRecipes.js`: dużo dymu,
  słaby błysk, bez fali i wtórnych; pełne paliwo — dym tego modelu gazu to głównie sadza ze spalania: przy połowie paliwa
  po 1,5 s prawie znikał, A/B w grze), rozmiar 16 · √węzłów w [80; 190] (kula mniejsza niż wybuch zbiornika pancernika),
  środek = środek zgniecionych węzłów przesunięty ku środkowi okrętu o 0,6 × size (`crushSmokeCenter` — zgnieciony obszar
  zajmuje dziób taranującego, a jego kadłub jest przeszkodą gazu); najwyżej raz na 0,9 s na okręt, nie do 0,6 s po
  pęknięciu zbiornika; ocena w kroku integralności PO sufitach punktów (okręt zabity zgniotem ma wybuch śmierci). Sam
  obraz. Atlas w taranie nie traci węzłów (pancerz 16), więc dymi ofiara. Pomiar (`zbiornik-taran-sym.mjs`, 6 kadłubów ×
  8 stron × 4 prędkości): dym przy szarży 42/42, W + Shift 41–42/42, lekkie zderzenie 300 j/s 1/42 (pęknięcie zbiornika),
  muśnięcie burtą 1/24. Otarcie bez zgniotu nie dymi (iskry `CollisionFX`; dym wraków `gasSmokeGame.js` dalej wypięty).
  A/B `ShipBlastTune.crush`, strojenie `window.CrushSmokeTune`, liczniki `window.CrushSmokeStats`; testy
  `tests/crushSmoke.test.mjs`; w grze `zbiornik-gra.mjs --tryb taran` (sceny bez trafienia w zbiornik).

- Receptury (`explosionRecipes.js`, czyste): profile (`fighter` … `final`, domyślny `capital`) jako mnożniki `size` — kula ognia,
  kłęby, strumienie, płonące odłamki, iskry, żar, odłamki konstrukcji, dym, błysk, światło, fala, gorące powietrze, wtórne, ogniska.

- Obraz (`explosionFx.js`, krok `Core3D.addFxStep` „wybuchy”): kula ognia i dym z GAZU (siatka 3D w compute: MacCormack skalarów
  i prędkości — v̂ w `velC`, spalanie z rozprężaniem, kurczenie przy stygnięciu, rzut Jacobi), STRUMIENIE z miejsca wybuchu
  (`GasExplosions.jet` — narzucenie prędkości źródeł gaśnie po 0,06 s z τ 0,15 s, strumień dalej żyje własną dynamiką), płonące
  odłamki („pająk”), żar porywany gazem (`gasEmbers.js`), błysk, iskry gry, odłamki konstrukcji (WeaponFx DEBRIS), jedno światło na
  wybuch w siatce, FALA jako sama refrakcja i gorące powietrze (`Core3D.fxDistortion()`), wtórne. Źródła, żar, łby odłamków i błysk
  jadą z nośnikiem domeny (`director.tune.followCarrier`, `slotVel` żaru). Warstwy: gaz za płaszczyzną gry — pass ortho przed
  kadłubami; przed nią, żar, błyski, łby — pass FG (warstwa 2) po bryłach FG.

- Gaz w próżni (`tuneGasForSpace`): bez wyporu, wiry 1 i turbulencja 10 (przy MacCormacku dawne 3,5 / 35 dawały energię rosnącą po
  wygaśnięciu źródeł), opór 0,23 + 0,03·|v| w środku ZOSTAJE (bez niego 15 iteracji Jacobiego nie domyka rzutu), gąbka 3/s przy
  brzegu domeny, kurczenie 0,3, zanik dymu 0,545/s, sadza 0,39, `domainLife` 3 s + wygaszanie 1,6 s (odżycie po nowym wybuchu
  — `grid.feed`: od razu; przedłużenie — rampą). Zmiana kernela → `wybuchy-sonda.mjs` (liczby przed / po; sonda zeruje zegar
  siatki i ziarno przed każdym przypadkiem — warianty są deterministyczne do ~1 %), detalu → `--ruch`.

- ZAPIS STANU f16 (2026-10-12): zapis f32 → f16 do tekstur storage na RTX / D3D12 OBCINA ku zeru — każdy zapis skalarów,
  prędkości i pozycji spoczynkowych działał jak ukryty zanik i opór (kula „capital” po 3 s: masa dymu −11 %, ciepło −9 %,
  energia w dymie −20 % względem poprawnego zapisu). `gasGrid.js` zapisuje denB, velC, velB, denC, velA, denA i restB
  z ZAOKRĄGLENIEM STOCHASTYCZNYM (`_w16` → `sroundF16`, `src/3d/tsl/zapisF16.js`; tryb sprzętu raz na urządzeniu —
  `ensureHalfRoundingProbe`, wspólny uniform `F16_ROUND_BIAS`; ciśnienie bez — Jacobi to większość dispatchy).
  A/B: `grid.tune.f16Round` (0 — dawny zapis). Obraz sprzed naprawy odtwarza strojenie gry: zanik dymu 0,52 → 0,545,
  opór 0,2 → 0,23, stygnięcie 1 → 1,04 (sonda: masa, ciepło, objętość ±3 % w całym życiu kul capital / final i łańcucha,
  energia ruchu pod koniec +3…10 %; koszt GPU bez zmian). Dema z własnym strojeniem (`createGasTuning` bez
  `tuneGasForSpace`) dostały poprawny zapis bez przestrojenia — ich dym gaśnie odrobinę wolniej.

- ŚWIATŁO w dymie (`gasVolume.js`): siatka świateł `Core3D.fx.grid` w marszu (`grid.loop` co 3 gęste próbki, kolano 0,45,
  samocień z przepuszczalności nad próbką 0,85) — dysze, lufy, trafienia, reflektory, lampy hal, inne wybuchy; światło WŁASNEJ
  domeny (właściciel `GAS_LIGHT_OWNER_BASE` + indeks globalny domeny; błyski wylotu przez `FxLights.owner`) tylko w dalekim polu;
  blask ognia z objętości światła z dalekim pierścieniem (`glowFar` 4, `glowGain` 2,5); otoczenie × jasność strefy nieba ×
  `sunFill`; OTOCZENIE DOMENY `GasSlot.ambient` (kanał `gasB.w` brył) — dziś dym zapłonu pod dachem hali K-7 (`interiorLight`).
  Nowa domena pod dachem dostaje światło tą drogą, nie przez luzowanie `gridKnee` / `gridShadow` (strojone pod wybuchy). Paleta
  ognia per domena `GasSlot.fire` (kanał `gasC.w`): wiersze `GAS_FIRE_ROWS` (`gasCommon.js`: 0 ciało czarne, 1 plazma Yamato,
  2 wodór; przejście liniowe między sąsiednimi), lustro `gasFirePaletteCpu`, blask `gasFireGlow`.

- PRZESZKODY (`src/game/gasObstacleInput.js` → `GAS_OBST_IN` → `__explosions.setObstacleInput`, szew gra ↔ render jak pył hal):
  statyka — pudła hal K-7 (`k7SolidList`, hale w kadrze i przy domenach) i bryły trafień budowli misji — baza piratów,
  suchy dok (czworokąt = pudło; wycinek pierścienia bębna i koła szybu / zbiorników = kilka pudeł z pasów między
  łańcuchami rogów, `putGasObstaclePoly`, nadmiar ≤ 5% bryły; kawałek ruszony — obrysy jego
  ciał), raster R8 w oknie 2N × 2N ZAKOTWICZONYM W ŚWIECIE (róg na siatce h, wyprzedzenie wzdłuż nośnika, bryła + 0,75 komórki);
  kadłuby — obrys z żywych węzłów belek (`hullFootprint`) z prędkością ciała + ω × r (do 64 rekordów i 32 pasm masek na siatkę,
  przebudowa obrysów w budżecie 0,3 ms), tylko przy `domainRects`; GOSPODARZ domeny (ród wybuchającego okrętu, strzelec, okręt
  zapłonu; do 16) nie jest przeszkodą swojego gazu. Komórka stała: flaga `velB.w` → `prs.z` → `velA.w`, Neumann w Jacobim,
  bez wnikania w rzucie + dopływ skalarów przy licu (`wallFill`), źródła zasłaniane marszem do początku kapsuły, odłamki i żar
  gasną w ścianie. Lustra CPU: `solidCpu`, `sourceOcclusionCpu`, `gasJacobiCellCpu`, `gasProjectCellCpu` (`checkProjectCpu` —
  porównanie z GPU). Przeszkody to pryzmaty przez całą wysokość domeny (kamery 3D: dym przy kadłubie ucięty pionowo), bez cienia
  w świetle gazu. Przełączniki `EXPLOSION_TUNE.obstacles / hullObstacles / hostExclude`.

- ATLASY I DOMENY (etap D): trzy siatki, dla reżysera, emiterów i żaru jedna — `GasGridSet` (`gasGridSet.js`: indeksy domen
  GLOBALNE `GasSlot.gid`, `GasSlot.index` — w atlasie swojej siatki; wspólne strojenie, początek, słońce, zegar): PODSTAWOWY
  `EXPLOSION_GRID.slots` 4 × 96² × 36 (kula 40–60 px promienia na ekranie, wystrzały i zapłony), „FINE” 2 × 128² × 48 (kula
  ≥ `fineMinPx` 60 px — decyzja użytkownika; `fineJacobi` 41), „COARSE” 12 × 64² × 24 (kula < `coarseMaxPx` 40 px). Bez wolnej
  domeny w swoim atlasie — inny (`_slotFor`; „fine” ostatni). SKALA KOMÓRKI `GasSlot.k` = komórki na promień kuli / (96 / 5,4):
  parametry w jednostkach komórek (sufit prędkości, siły, szum, opór kwadratowy, dopływ przy ścianie, krok samocienia, promienie
  blasku; w obrazie gęstość optyczna i płomień / k, detal i przesunięcie odczytu × k) skalowane w kernelach i marszu — rozdzielczość
  nie zmienia strojenia (k = 1 — bit w bit); pasy względne domeny przez `nRef`. `domainScale` 5,4 (4,2 odrzucone sondą: dym dochodził
  do ścian domeny). Nowy parametr gazu w jednostkach komórek — dopisz go do skalowania k (reakcja, rzut, światło, marsz).

- PAMIĘĆ: 10 atlasów RGBA16F na domenę (12 ról — wiry ≡ `prsA`, objętość światła ≡ `denB`: rozłączny czas życia w kroku; żaden
  kernel nie czyta i nie pisze tej samej tekstury — strażnik `tests/gasTiers.test.mjs`): podstawowa 26,5 MB, „fine” 62,9 MB,
  „coarse” 7,9 MB — razem 326 MB (bez „fine” 201 MB). Alokacja LENIWA: atlas 1 × 1 × 1 do swojej pierwszej domeny (rozgrzewka
  kompiluje na małych), „fine” wraca do 1 × 1 × 1 po `fineRelease` 20 s bez domen. Kanały zajęte: flaga stałej (`velB.w`, `prs.z`,
  `velA.w`), tempo spalania / −stygnięcia (`denC.w`), instancje brył `gasB.w` (otoczenie), `gasC.w` (paleta); wolne: `velC.w`,
  `restA / restB.w`, `prs.w`. Konfiguracja przed startem (harness): `window.__EXPLOSION_GRID` (np. `slots=10,fineSlots=0,
  coarseSlots=0` — siatka sprzed D), `window.__EXPLOSION_TUNE_OVR`.

- SCALANIE: wybuch dokłada się do żywej domeny, gdy jego KULA mieści się w kole życia gazu (`FIT_RR` 0,68 · pół boku − 2h,
  R ≥ 3 komórki), nośnik ±60 j/s i domena przyjmie gospodarza; kula < 8 komórek promienia dostaje własną domenę, gdy jest wolna
  (łańcuch doku = kilka ostrych kul — decyzja użytkownika); wtórne dziedziczą domenę rodzica bez progu `gasMinPx` (pozycja jedzie
  z nośnikiem od chwili wybuchu rodzica). Bez wolnej domeny: łagodniejsze scalanie (pół promienia — `RELAX_FIT_R`), domena efektu
  w wygaszaniu, domena wybuchu w końcówce wygaszania (obraz ≤ 0,2), dowolna domena efektu, presja (domeny bez zasilenia od 2,2 s
  wygasają szybciej) — dopiero wtedy cząstki; żywej domeny wybuchu się nie zabiera. Nowa domena od `GAS_MIN_PX` (14 px).

- DOMENY EFEKTÓW (`isEffectTag`): wystrzał z lufy (`MUZZLE_TAG`; hak `WeaponFx.muzzleGas` przy wylocie bogatym armaty i Yamato —
  `MUZZLE_GAS`: domena na okręt strzelający, 10 komórek na promień wylotu, życie 0,45 s + wygaszanie 0,6 s + zanik 1,6/s, nośnik =
  prędkość lufy, Yamato w palecie plazmy, dym cząstkowy wylotu × 0,15 — `m.smokeK`) i zapłon silnika (`ENGINE_TAG`; `EngineFrame`
  — dysze klatki, fazy dym / płomień / gaszenie raz na sekwencję, domena na okręt 0,4 L za dyszami, źródła ≥ 3,5 komórki, nośnik
  z chwili zapłonu, dym `engineTint`, paleta z palety strugi `ENGINE_FIRE_ROW`, błysk i światło zapłonu; § „Odpalanie i gaszenie
  silników MAIN”). Tylko atlas podstawowy, sufity `muzzleDomains` 3 / `engineDomains` 2, zapas `muzzleReserve` 2 wolnych domen
  (w dowolnym atlasie) i wolna domena podstawowa; WYBUCHY MAJĄ PIERWSZEŃSTWO — nie scalają się z domeną efektu, bez wolnej ją
  przejmują (emitery gasną), efekt nigdy nie zabiera domeny wybuchowi.

- DOMENY GŁĘBOKIE (2026-10-19 — uderzenia w planetoidę pod bazą piratów, § „Baza piratów”; też wylot powietrza z dysku
  mieszkalnego): domena pod płaszczyzną gry w passie TŁA (warstwa 1, kamera perspektywy jak skała — w passie ortho głęboki obłok
  stałby w złym miejscu): `ExplosionFx.deepDomain(x, y, z, R, opts)` (świat gry; `up`, `upShift`, `ground` — KULA-przeszkoda
  { x, y, z, r }, `carrier`, `life`, `fadeTime`, `baseDecay` ≥ −0,4, `tint`, `fire`, `tag`, `ambient`, `tier` albo progi
  `fineMinPx` / `coarseMaxPx`, `domainScale`, `minPx`, `reserve`, `inView`) → indeks globalny; emitery `director.jet / puff /
  fire / trail` w scenie (Y = −y). `GasSlot.deep`: bryły `GasVolume.createDeepMeshes` (przód z testem głębi — bryły passa tła
  przed obłokiem go zasłaniają; tył bez testu, gdy kamera w pudle), marsz przez całe pudło do pierwszego przecięcia z kulą
  (`gasSphereClipCpu`), cień kuli w świetle `setDeepSun` (`gasGroundLitCpu`; półcień `deepPenumbra` 450 j. — ostra linia cienia
  skały w obłoku przy terminatorze wyglądała jak cięcie), bez świateł siatki i maski słońca płaszczyzny gry;
  w symulacji kula = komórki stałe (`gasGround` w `_solidAt`, ściany także w osi z w rzucie — przy pryzmatach bit w bit jak
  dawniej), gaz rozlewa się po niej. Ogólne (dowolna domena, np. nad płaszczyzną — głowa wieży): `noStatics` / `noHulls` (opcje
  `acquire` i pola slotu; deep ustawia oba) — bez rastra statyki (pryzmaty budowli przez całą wysokość) i bez kadłubów. Wybuch
  w płaszczyźnie nie scala się z domeną głęboką (`_fitSlot`), prostokąty domen dla kadłubów jej nie mają, budżet marszu liczy ją
  z rzutem perspektywy. Koszt GPU mierz jako `Core3D.gpuFrameMs` + `Core3D.gpuComputeMs` (sam render nie obejmuje symulacji gazu).
  PUDŁO JEST PŁASKIE (wysokość = NZ / N ≈ 0,375 szerokości; obraz i symulacja gaszą gaz za ~0,9 elipsoidy wpisanej w pudło):
  źródło wzdłuż osi z (pióropusz z uderzenia w szczyt skały) bez dopasowania wbija się w sufit — gorący słup ucięty płasko
  i ciemna płyta dymu pod sufitem w kamerach 3D (2026-10-19). Prędkość strumienia dopasuj do miejsca w elipsoidzie
  (`RockImpactFx._fitAlong / _fitSpeed`: zasięg ≈ len + v · (czas + 0,6 s) ≤ 0,8 drogi do brzegu), środek domeny trzymaj
  blisko punktu źródła w pionie (`upShift` małe — elipsoida najszersza w połowie wysokości), a gęstemu dymowi daj `ambient`
  (bez niego rdzeń obłoku pod słońcem z boku jest czarny).

- KOSZT MARSZU (F13): budżet próbek klatki (`marchBudget` 40 mln — Σ px pudła domeny w kadrze × komórki w pionie / krok) —
  ponad nim krok marszu rośnie proporcjonalnie (do × `marchStepMax` 2,5; w górę od razu, w dół powoli); przy kroku × 1,3 obraz
  bez różnicy na zrzutach. `drawGas` — A/B samego marszu.

- Zegar `SimClock.sim` (pauza = wybuch stoi; dema — `clock`), losowanie tylko fxRandom, pozycje względem `Core3D.fx.origin` (żar
  w początku pul z kernelem przesunięcia). Rozgrzewka: puste dispatche kerneli wszystkich siatek i żaru, bryły każdego atlasu
  w passie swojej warstwy z kamerą z góry i 3D — 0 pipeline'ów synchronicznych w klatkach wybuchów, wystrzałów i zapłonów.

- Koszt (RTX 5080, 1600 × 900; maszyna współdzielona — porównania A/B w tym samym przebiegu): łańcuch doku (zoom 0,085, 13 wybuchów,
  do 13 domen) klatka 3,2 ms wobec 2,35–2,7 bez wybuchów; marsz dużej kuli (1–6 domen) zoom 0,4: GPU +0,5 ms (p95 +1,0), zoom 0,8:
  +1,0 ms (p95 +2,3); światła siatki w marszu +0,02–0,10 ms; bitwa (12 zgonów naraz, zoom 0,16) klatka ~3,3 ms (bez „fine” 2,7),
  CPU kroku 0,26–0,29 ms; wystrzały (strzelnica) GPU +0,01 ms, zapłony (4 okręty naraz) +0,09 ms; przeszkody CPU ~0,05–0,07 ms.
  Bez domeny (`noSlot`): łańcuch doku 1–5 z 61–72 wybuchów (siatka sprzed D: 11), bitwa 0 (sprzed D: 2 na serię).

- Strojenie: `EXPLOSION_TUNE` (przełączniki warstw działają na żywe wybuchy — A/B tej samej klatki), `__explosions.volume.look`
  (wspólny dla brył wszystkich atlasów), `__explosions.grid.tune` (wspólne). Narzędzia: demo `dema/wybuchy-webgpu.html`
  (`?siatka=k=v,…`), `node scripts/webgpu/wybuchy-demo.mjs [--ruch] [--koszt]`, gra `node scripts/webgpu/wybuchy-gra.mjs [--sceny
  prog,lancuch,stacja,pustka,dysze,maszt,pas] (prog — próg punktów habitatu bazy piratów, lancuch — rozpad habitatu i reakcja
  w rurach, maszt — maszt reflektora L-F) [--ab klucz] [--gpu] [--koszt [--kosztSwiatla | --kosztPrzeszkody]] [--marsz
  [--marszZoom 0.4,0.8]] [--siatka k=v] [--tune k=v]`, sonda fizyki `wybuchy-sonda.mjs [--siatka k=v]` (wielkości bez jednostek
  komórek: `massN`, `rGN`, brzeg domeny), przeszkody `wybuchy-przeszkody-sonda.mjs` (przeciek, erozja, GPU ↔ CPU) i
  `przeszkody-gra.mjs` (pomost MP bazy, wyrwa, ściana bębna habitatu, ruszony kawałek, przelot, gospodarz, hala), zbiornik `zbiornik-gra.mjs [--tryb sceny,bitwa]
  [--siatka]`, wystrzał `wystrzal-gra.mjs [--tryb strzelnica | bitwa | dok]` (dok — Atlas przed magazynem bazy), zapłon `zaplon-gra.mjs`; testy `tests/explosions`,
  `gasGrid`, `gasObstacles`, `gasTiers`, `fuelTank`, `engineIgnition`. Dym i ogniska WRAKÓW (`gasSmokeGame.js`, własny `GasGrid`)
  dalej wypięte (decyzja użytkownika); cienia dymu na scenie nie ma (F11).
