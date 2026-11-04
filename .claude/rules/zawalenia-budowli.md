---
paths:
  - "src/game/structure*.js"
  - "src/game/beamRigid3D.js"
  - "src/game/beamPlateField3D.js"
  - "tests/structure*.test.mjs"
  - "tests/beamRigid3D*.test.mjs"
  - "tests/beamPlateField3D.test.mjs"
  - "scripts/struktura-sym.mjs"
  - "scripts/klastry-sym.mjs"
  - "scripts/zawalenia-sym.mjs"
  - "dema/zawalenia-budowli/**"
  - "dema/zawalenia-budowli.*"
  - "scripts/webgpu/zawalenia-demo.mjs"
  - "docs/PLAN-zawalenia-budowli-3d.md"
---

# Zawalenia budowli („Teardown bez wokseli”): graf nośny, klastry sztywne, pole płyty, prefraktura

> Reguła obszaru (2026-11-04, etap E0b planu `docs/PLAN-zawalenia-budowli-3d.md`). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł są w `AGENTS.md`. Odnośniki: „plan § X” — sekcja planu zawaleń; „§ X” bez słowa „plan” — nagłówek reguły (jak w `AGENTS.md`); „D…” — decyzja użytkownika (plan § 8); „E…” — etap (plan § 6). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym. Wyniki pomiarów i historia idą do planu (plan § 6.2 — stan etapów, plan § 8 — decyzje). Nowe pliki obszaru nazywaj `src/game/structure<Nazwa>.js` i `tests/structure<Nazwa>.test.mjs` — wtedy wchodzą w `paths` i w strażnika `tests/structureZasady.test.mjs`. Glob katalogu, którego jeszcze nie ma (`src/3d/structures/**` — E4, pliki dema D20), dopisz razem z pierwszym zatwierdzonym plikiem, bo `tests/agentsMd.test.mjs` wymaga, żeby każdy glob trafiał w śledzony plik. Sąsiednie reguły: `ciala-swiata` (kawałki, bańka, skóry, `breakPiece`), `kadluby-belki` (silnik belek, bryły 3D, prawo kontaktu v2, punkt „KLASTRY SZTYWNE i POLE PŁYTY w silniku”), `baza-piratow` (baza, szyja, upadek habitatu, skała).

## Stan

- Belki NIE niosą ciężaru: grawitacja silnika to przyspieszenie całego ciała, „statyczny ciężar nie gniecie”. Dlatego kruszenie i runięcie budowli liczą osobno:
  - GRUBY GRAF NOŚNY (E1, `src/game/structureGraph.js`);
  - KLASTRY SZTYWNE `rigid` dla oderwanej masy (E2, `src/game/beamRigid3D.js`);
  - POLE PŁYTY dysku mieszkalnego (E2, `src/game/beamPlateField3D.js`), związane z grafem dysku przez `src/game/structurePlate.js` (demo D20 krok 5).
- Klastry i pole płyty są wpięte w silnik belek (`destructorBeams3D.js`, `hullBodies.js`). Graf, klastry i pole płyty są NIEWPIĘTE w grę: `index.html` nie woła `structureGraph`, `HullBodies.createCluster` ani `HullBodies.warmUpClusters`.
- Do wpięcia budowle bazy piratów pękają po staremu: `breakPiece` (reguła `ciala-swiata`, ROZPAD), skrypt upadku habitatu `pirateBaseFall.js` i `_chainExplosion` w `storyGame.js` (reguła `baza-piratow`).
- Nie ma jeszcze:
  - prefraktury L2 i archetypów z wypieku offline — E3; benchmark `prefraktura.mjs` leży poza repo w `.tmp/destrukcja-2026-11-03/bench/` i w E3 przechodzi do `scripts/`;
  - obrazu (`src/3d/structures/`, blok migawki `structBlock`, rekordy `STRUCT_*`, pula gruzu) — E4;
  - grafów H-T, bębna i szybu H-C (D14): w demie H-T to bryła belek z gry, po minięciu dysku jeden klaster z prostopadłościanów (D6 zastępczo), bębna i H-C nie ma — E7;
  - `window.StructureTune` i strojenia egzemplarza — D20 / E5;
  - flagi `?zawalenieStare=1` — E5–E7;
  - potoku archetypów z modelu i znaczników (`buildStructureArchetype` w plan § 10 to nazwa robocza) — E3 / ogólność;
  - PRNG rozpadu dla `Math.random` w `shatter`, `breakPiece` i kraterze (plan § 3.7, zasada 9) — etap do decyzji (propozycja E5);
  - HP bloków oderwanego klastra (D4) — miejsce stanu do ustalenia, E5.
- Kolejność: E0 i E0b zrobione → demo D20 → E3 prefraktura z wnętrzami → E4 obraz → E5 wieżowce → E6 dysk → E7 habitat i wycofanie starej ścieżki → E8 łata skały → E9 ruiny i zapis → E10+ ogólność (plan § 6, § 10). Bramki go / no-go po E1 i E2 przeszły (plan § 6.2).

## Decyzje użytkownika (plan § 8 — obowiązują)

- Masy zawaleń to klastry sztywne plus gruby graf nośny, NIE bryły belek 3D (D0, 2026-11-03). Wariant „silnik belek prawdziwie 3D dla K-7, ringu i budynków” z 2026-10-15 nie dotyczy zawaleń. H-T schodzi z belek po minięciu dysku (D6; rezerwa: komórka 67).
- „Tarcza” pod habitatem to dysk mieszkalny (D1). Kratery w skale — opcjonalnie później (E8).
- Wieżowiec kładzie się W STRONĘ STRZAŁÓW: przechył 30–45°, potem zgniot (D11).
- Pas broni ±70 podcina, wyżej kruszy fala w konstrukcji i graf, bez rzutowania trafień po kamerze (D3).
- Punkty wieżowca przechodzą w nośność. Broń zmienia pęd i wytrzymałość wiązań, nie HP bloków stojącej budowli. HP bloków mają dopiero oderwane klastry (D4).
- Zakres: najpierw wieżowce i habitat, ale reszta bazy też (D14): wyłom bębna w E7, magazyn, paliwo i pomosty zaraz po E7.
- Wnętrza (stropy, słupy, szyb / rdzeń z archetypu) docelowo we WSZYSTKICH budowlach (D9).
- Pył zawaleń to cząstki, bez obłoków gazu w szczycie (D2). „Bez dymu” z 2026-10-05 było zakresem jednego wdrożenia, nie zakazem — wybuchy z gry (`GameBlasts.blast`) przy zawaleniach są dozwolone.
- Dźwięk później, teraz tylko hak w zdarzeniach (D18).
- Klastry ranią WSZYSTKIE okręty jak taran: Atlasa, sojuszników, piratów, także przy ringach, w strefach stanowisk i halach. Gruz obrazu nie rani (D5).
- Wrogowie zabici zawaleniem, które wywołał gracz, liczą się graczowi; sojusznicy nie. Zawalenie pamięta sprawcę (D5b).
- Zniszczony pomost odbiera wieżowcowi podparcie: kotwica `section`, kierunek z grafu (D13).
- Ujęcie zawalenia ustawia reżyser kadru z przewidzianego czasu (D15). Bez zwolnionego tempa (D16).
- g budowli: A/B na nagraniu (demo D20 / E5), skłania się ku WOLNO, 5–7 s (D12).
- Ring: g według planety — 400 × 0,29 (Mars), × 1,9 (Jowisz), bez Coriolisa, z poprawką o skalę D12 (D10c).
- Habitat:
  - rów w szyi w kształcie wieży (D7);
  - utrzymanie = jeden zegar ~2,5 s (D8);
  - osada i winda to scenariusz, ale lina windy jest przypięta do kawałka dysku i reaguje, gdy ten pęknie (D17, E6);
  - wieża jak dziś (~14 s do skały), reszta (bęben, dysk, gruz) dolatuje WYRAŹNIE później (D22).
- Ruiny są w zapisie (D10a).
- Porty, ringi i hale odnawiają się powoli i widocznie. Uszkodzenie budowli przyjaznej oznacza mandat i drony naprawcze; bazy z misji zostają ruiną (D10b).
- Hale K-7 i magazyny walą się naprawdę po pęknięciu podpór. Zniszczenie jako sojusznik daje ogromną karę (D23).
- Ogólność bez stacji: reszta bazy z dokami → Jowisz → Mars (budynki ringu z kolizjami, D19) → K-7 → Ziemia (D10d).
- Z7 dopiero po dopracowaniu przez użytkownika. Nowa budowla = model + znaczniki (podpory, kotwice, wnętrze) → archetyp z wypieku, bez ręcznej pracy w kodzie gry poza warstwą gry źródła (D24).
- Radar jest poza planem — zawalenia nie dokładają rekordów `radarFeed` (D21).
- Demo na szarych blokach powstaje przed E3: zawalenie widać od razu po otwarciu, bez nakładek debug (D20).
- `wreckPairEvery` dla wolnych par klastrów to tylko rezerwa, gdy E7 nie zmieści się w budżecie (D16b).

## Zasady obszaru

- Prawda gry: graf, klastry, pole płyty i lądowanie liczy wątek gry (zasada żelazna 1). Obraz (kawałki L2, gruz, pył) z niczym się nie zderza. Docelowo (E3, plan § 3.1): dane gry archetypu liczy wątek gry (ekran ładowania, w Node synchronicznie), geometrię L2 — worker skór renderu. Wspólny kod jest bez three, z tym samym ziarnem; do renderu idą tylko numery.
- Moduły obszaru są czyste: bez three, DOM, `window` i `Math.random`. Rozrzut pochodzi z PRNG ziarna archetypu (`structureRng`, mulberry32).
- Importy: `stepDecay.js`, czyste dane układu z `src/3d` (`pirateBaseLayout.js`, `haloPortK7Layout.js` → `haloRingConfig.js` → `ringScale.js`) i moduły obszaru między sobą. Nowy import — tylko moduł bez three / DOM, dopisany do listy strażnika.
- Zegar ściany:
  - `structureGraph.js` nie czyta zegara;
  - `beamRigid3D.js` / `beamPlateField3D.js` czytają go tylko przez `nowMs()` w gałęzi `timing` (`D.rigidPerf.timing`, `D.platePerf.timing` — domyślnie false, włącza `klastry-sym.mjs`). W grze `performance.now()` i zapis liczb w liczniki kosztowały.
  - Silnik belek (`destructorBeams3D.js`: `D.perf`, `clock` żaru) czyta zegar w `update` / `integrate` bezwarunkowo — test zegara obszaru woła przebiegi modułów wprost, nie przez `D.update`.
- `Math.hypot` tylko w budowie archetypu (`build…Archetype`).
- Strażniki: `tests/structureZasady.test.mjs` (statycznie), `tests/structureZegar.test.mjs` (szpieg zegara).
- Budżety liczbowe na 1/120 s przez `ticksAt120`, nigdy czasowe. Zmęczenie w 1/s × czas od ostatniej oceny — 60 i 120 Hz dają te same zdarzenia w czasie.
- Bez alokacji w kroku (`stepStructure`, `structureSolveIsland`, front, pole płyty, pary klastrów): bufory z `createStructure` i `rigidReserve`. Gorące pętle pod V8 (pomiar 2026-11-04 — V8 pakuje liczbę, czyli alokuje):
  - bez liczb zmiennoprzecinkowych w argumentach i wynikach funkcji pomocniczych;
  - bez pisania liczb w pola dużych obiektów;
  - bez `let x;` bez wartości.
- Budżety zaimplementowane:
  - ≤ 64 zerwania na 1/120 s (`breaksPer120`, nadmiar w kolejce);
  - rekordy zdarzeń grafu ≤ `STRUCT_EV_CAP` 64 na krok; w tym rekordy BREAK ≤ `breakRecords` 24, dalsze zbiorczo `BREAKS`, ponad pojemność `OVERFLOW`;
  - front ≤ 1 poziom na 1/120 s (`frontLevelsPer120`, nadmiar czasu w `F.lag`);
  - ≤ 256 żywych klastrów (`maxClusters`, osobno od `maxWrecks`). Ponad limitem `createCluster` zwraca null, a wołający oddaje masę w gruz obrazu;
  - ≤ 160 aktywnych klastrów (`clusterMaxActive`). Nadmiar wolnych podpartych zasypia od najlżejszego.
  - ≤ 4 narodziny klastrów na 1/120 s w gospodarzu (`COLLAPSE_TUNE.birthsPer120`; nadmiar czeka — bloki zostają u starego właściciela);
  - jedna wyspa swobodna na krok w gospodarzu (`structureSolveIsland`, `S.islPend` ma jedno miejsce).
- Budżety planowane — wchodzą z wpięciem (plan § 3.4–3.5): ≤ 8 solverów, ≤ 2 pełne zawalenia naraz (habitat się wlicza), ≤ 2 aktywacje budowli na krok, ≤ 64 rekordy `STRUCT_*` na krok (nadmiar zbiorczo), ≤ 8 `ROCK_IMPACT` na krok. Nadmiar idzie w gruz obrazu albo zamrożenie, po masie i id.
- Silnik belek liczy statki i bryły BIT W BIT przy klastrach w kroku — szczegóły integracji w regule `kadluby-belki`, punkt „KLASTRY SZTYWNE i POLE PŁYTY w silniku”. Zmiana fizyki klastrów albo płyty wymaga:
  - `node scripts/klastry-sym.mjs` przed i po;
  - testów `beamRigid3D*`, `beamPlateField3D`;
  - złotych testów `beamLocalSolverExact`, `beamNarrowphase`, `beamStore3D` i progów `destrukcjaTaran`, `pirateBaseFall`.

## Graf nośny (E1, `src/game/structureGraph.js`)

- Bloki (masa, poziom, sektor, kotwica `ground` / `support` / `section`) i wiązania osiowe. Sztywność: k·n·nᵀ plus ścinanie `shearK` 1e-6 (większe ścinanie zjada moment wspornika: przy 1e-4 — do 3,8%).
- Przekroje kalibrowane per wiązanie z podłogami grupy, poziomu i budowli: nienaruszona budowla ma wykorzystanie ~0,5 na KAŻDYM poziomie.
- Solver: CG 25 iteracji z prekondycjonerem blokowym Jacobiego (3×3 na blok), ciepły start, przebieg co 4 kroki 120 Hz z przesunięciem faz, tylko po zmianie.
- Wiązania ocenia się WYŁĄCZNIE przy reszcie ≤ 0,02 liczonej na tej samej macierzy co siły. Niezbieżny przebieg to tryb miękki (`shearMech`); po 24 takich mechanizm pęka na brzegu (tryb `MECH`). Zmęczenie działa między limitem sprężystym a krytycznym (`critMul`); wyspy liczy union-find. Kontrola przekrojów kondygnacji łapie wywracanie niezależnie od zbieżności.
- Archetyp RAZ na rodzaj budowli: `createArchetypeBuilder` → `addBlock` / `addBond` → `finishArchetype` (kalibracja, rozrzut ±15% z ziarna). Budowa nie zależy od stanu modułu — test determinizmu buduje W-1 po innych testach i po `structureReset` egzemplarza, a limity i kalibracja wychodzą bit w bit.
  - Gotowe archetypy: `buildHighriseArchetype` (W-1 / W-2: 178 bloków, 18 poziomów z `k7HeightToZ`) i `buildDiscArchetype` (dysk mieszkalny: 316 bloków, kotwice `support`).
  - Egzemplarz `createStructure(A)`, krok `stepStructure(S, dt, tick)`, reset `structureReset`, liczniki `structureCounts`.
  - Układ lokalny archetypu: wieżowiec — x wzdłuż pomostu; dysk — środek habitatu; z świata. Przekształcenie świat → lokalny robi gospodarz (E5). Masa bloku w „węzłach komórki 45”; masa silnika belek = masa grafu × 45² (`STRUCT_MASS_UNIT` 2025 — jednostka węzła bryły, D5).
  - `g` archetypu (D12 / D10c): opcja `build…Archetype({ g })`, domyślnie 400 — bit w bit z E1 (złote hasze w teście). Kalibracja skaluje limity z ciężarem, przy g ≠ 400 `tune.waveJ` × g/400. Gospodarz skaluje J broni × g/400 — wtedy historia zerwań jest ta sama (lista, kolejność, czasy), a różni się tylko ruch.
- PROSTOPADŁOŚCIANY BLOKÓW L1 (geometria dla klastra, obrazu i trafień; plan § 3.1):
  - budowniczy `addBlockBox(B, blok, cx, cy, cz, hx, hy, hz, yaw, waga)`; `finishArchetype` składa CSR `A.boxStart` (n + 1) / `A.boxData` (`STRUCT_BOX_STRIDE` 8 słów: środek, półosie, yaw wokół z, udział masy), `A.boxCount`. Udziały masy bloku normalizuje do Σ = 1 (waga = objętość). Kotwice nie mają prostopadłościanów;
  - `structureBlockBoxes(A, bloki, ile, out, massUnit = 2025)` → `[{ x, y, z, hx, hy, hz, mass, id, q }]` — wejście `buildClusterDesc`. `out` wraca do użycia, kwaternion jest zawsze nowy (opis klastra trzyma referencje `q`);
  - wieżowiec (418 prostopadłościanów W-1): blok obwodu poziomu l to ściana kondygnacji POD jego stropem (odcinek między połowami dróg do sąsiadów, grubość `wall` do środka obrysu, ściany y = ±hy z rogami jak w modelu) i kafle stropu (~80 j.) przypisane najbliższemu blokowi; narożnik to dwa ramiona w L (przy gęstym obwodzie poziomów 0–3 krótsze ramię < 6 j. odpada). Rdzeń to słup coreW² przez kondygnację, iglica — prostopadłościan o polu walca r 30;
  - dysk (632): wycinek × warstwa (dolna ½T; górna ½T + tarasy jak masa), 2 promieniowo na wycinek (`boxSplit`), obrót yaw. Prostopadłościan leży w wycinku z luzem, pokrycie pierścienia ~87%;
  - ZASADA: prostopadłościany RÓŻNYCH bloków nie nachodzą na siebie — klaster urodzony w przenikaniu dostaje wyrzut. Luz `STRUCT_BOX_GAP` 1 j. odejmuje się od każdej półosi (≥ 2 j. między sąsiadami), test SAT. Nowy archetyp z prostopadłościanami trzyma tę zasadę;
  - środek masy prostopadłościanów leży niżej niż środek masy grafu (W-1 ~41 j.), bo blok grafu stoi na stropie swojej kondygnacji. Pozę klastra liczy się z jego własnego środka masy, nie z rekordu ISLAND.
- Obciążenia:
  - `structureDamageSphere` / `structureDamageBond` (kratery);
  - `structureHit` — FALA W KONSTRUKCJI: impuls J / `pulseT` i osłabienie wiązań nad trafieniem, malejące z wysokością. Bez fali graf zrywa się dopiero tuż przed upadkiem;
  - `structureAddLoad` / `structureAddImpulse`, `structureDestroyBlock`, `structureReleaseAnchor`;
  - `structureSetHold` — utrzymanie habitatu, zegar D8.
- Zdarzenia trafiają do bufora `S.ev` (`STRUCT_EV_STRIDE` 16 słów). Odczytuj je przed następnym krokiem, także po `structureSolveIsland`.
- ZAWIAS: kierunek z mimośrodu podparcia oderwanej wyspy (poniżej 0,05 promienia rzutu — spadek pionowy), punkt na ostatniej linii podpór po stronie przeciwnej. Wieżowiec kładzie się ku stronie podciętej (D11).
- „Plaster” (≥ 3 poziomy, rzut < 0,4) pęka na paczki po 2 poziomy.
- FRONT Bažanta–Verdure (`createCollapseFront` / `structureStartFront`): R = κ · 1,25 · ciężar nad kondygnacją. Przy κ 0,1–0,3 front schodzi do ziemi, przy κ 1 staje.
- WYSPA SWOBODNA (`structureSolveIsland`, odciążenie bezwładnościowe — jednorodne przyspieszenie nie daje naprężeń): zrywa tylko przy reszcie ≤ 0,02. Inaczej zwraca −1 i przy następnym wywołaniu kontynuuje od zapamiętanych przemieszczeń. Wołać co krok, aż wynik ≥ 0 (zimny start dużej wyspy: 9–25 wywołań).
- PŁYTA (prototyp 1-DOF: `createPlateField`, `plateGather`, `plateCrush`, `plateImpactScenario`): jeden próg nośności NIE rozdziela szyi (wieża leży na dysku, ma trzymać) od upadku (habitat spada, ma przebić) — luka ×27.
  - Nośność zależy od utrzymania: σ = σ_free + hold · (σ_held − σ_free), σ_held 200, σ_free 4. Ten sam wzór działa w polu płyty silnika.
  - Podpory dysku trzymają połowę nośności przy utrzymaniu 0 (`supportHoldFloor` 0,5), więc dysk po HP 0 nie odpada sam.
  - Styk 6-DOF klaster × pole to E6.
- Granica modelu: 3 DOF na blok, bez momentu w węźle. Zginanie niosą pary sił w pasach (wiązania osiowe), wywracanie widzi kontrola przekrojów. Znana luka: 60 / 120 Hz w szyi dysku (przy ω0 0,55 rów −20%, energia −34%; przy 0,85 −3% / −7%) — test `todo` do E6.

## Gospodarz zawalenia (`src/game/structureCollapse.js`, demo D20 krok 3)

- Łączy graf z klastrami tak, jak wepną to E5–E7: `createCollapseHost(A, { bodies: HullBodies, origin, yaw, ground, kappa, debrisFrac, angularDamping, gravityWell, id, seed, tune })`, krok `collapsePreStep(H, dt)` → `HullBodies.step(dt, [..., ...H.entities])` → `collapseStep(H, dt, tick)`; broń `collapseWeaponHit` (krater + fala, J z `COLLAPSE_WEAPONS` × g/400), `collapseCharge` (ładunek kondygnacji), `collapseReleaseAnchor` (D13); odczyty `collapseRecords` (pierścień rekordów `COLLAPSE_REC`, 16 słów), `collapseTimeline`, `collapseStats`, `collapseProbe`; `collapseReset`, `collapseDispose`; teren sceny `collapseGroundTerrain` / `collapseGroundZ` (jeden na kilka gospodarzy). HullBodies przychodzi z opcji — import ściągnąłby `Math.random` do domknięcia importów obszaru.
- ŚWIAT gospodarza = świat silnika (x gry, −y gry, z); hak styku przychodzi w świecie gry — gospodarz odbija y. Klaster = układ archetypu (J_lokalny = Rᵀ·J / massUnit). g gospodarza = A.g. Strojenie: `COLLAPSE_TUNE` + `opts.tune` (zamrożone; w narzędziu `--set`).
- KIKUT = zamrożone klastry, jeden na poziom. UZGADNIANIE po zmianie `S.topoVer` (prawdą `S.island` / `S.dead`, nie zdarzenia): narodziny w budżecie, od najcięższej wyspy; respawn z pozą i polem prędkości rodzica (pęd i moment ±1% — test); wyspa z 1 bloku → blok ginie w grafie (gruz obrazu); ≤ 2 bloki od budowli → kopnięcie z PRNG gospodarza; sufit 256 → gruz.
- PUNKTY STYKU CIENKICH PŁYT: `buildClusterDesc` daje kule do ½ środkowej półosi, więc kafle stropu i rdzenie kondygnacji 35 j. wystawały ~13 j. w sąsiedni poziom, czyli w INNY klaster na granicy wyspa / kikut albo dziecko / rodzic (pomiar: wyspa W-1 przy narodzinach Δv 113 j/s, potem rozbita). Opis styku idzie z `_contactBoxes`: płyta rośnie w dół kondygnacji, a prostopadłościan ze środkową półosią > 2 × najmniejszej dzieli się wzdłuż niej (masa i tensor bloku bez zmian). Test: 0 przenikania kul między poziomami kikuta. Nowy archetyp — ta sama zasada.
- IMPULSY WYSP: bufor gospodarza na blok (ocena części zakotwiczonej zeruje `S.jx`). Łata styku `contactR` 150 j. — hak podaje jeden blok na parę, a cały impuls w jednym bloku rozbijał wyspę w drobny gruz. Uderzenie = Δv > `impactDv` 60 j/s (osiadanie na luzie 2 j. przy g 400 to 40). Do grafu idzie × `impactScale` 0,5 (przy 1 wieża po upadku rozpadała się w gruz, 158 ze 178 bloków; przy 0,5 — 5–9 klastrów). Wyspy na zawiasie i we froncie nie dostają rozwiązań: róg na ziemi to podparcie, a rozwiązanie wyspy swobodnej nie zna reakcji przegubu.
- ZAWIAS (D11): przegub + ω0 `hingeKick`, wyspa BEZ par (`noHullCollisions`) — styk z zamrożonym kikutem zakleszczał przechył, a tempo zależało od tłumienia spoczynku silnika. Kikut, w który punkty dolnych poziomów wyspy wchodzą głębiej niż `crushDepth` × promień, ginie zmiażdżony (`_crushUnder` → `structureDestroyBlock`, gruz). Przegub pęka kątem (v2 grafu, 40°) albo ZASTOJEM (przyrost < 0,5° w 1 s × √(400 / g)). Podcięcie w pasie ±70 daje zawias 86–226 j. nad pokładem, a róg wieży W-1 (rzut 380) siada na ziemi przy 13–36° (bateria sceny 1: 25,7°) — 40° osiąga tylko wieża na pomoście nad pustką. Zastój z narożnikiem na ziemi → bez frontu (front zrzucał wieżę o kondygnację w ziemię i rozbijał ją przed przewróceniem).
- PRZEWRACANIE: wyspa zawiasu i jej przebudowy mają `restDamping` 0 (`topple`); kikut, którego dotyka, kruszy się (`crushTouch`). Wieża w równowadze chwiejnej na narożniku (niskie g — ruch spada pod próg snu silnika) dostaje pchnięcia ω (`toppleNudges`). Gdy nie ruszyła (przechył < ~20° — oparta narożnikiem stabilnie), dostaje NACISK: obciążenie styku z okna `stuckStaticEvery` idzie jako siła do grafu wyspy i narożnik się kruszy. Koniec przewracania przy `toppleEndDeg` 80° albo po `stuckStalls` zastojach. Nacisk od początku przewracania (`staticEvery` skończony) to tylko A/B do R1: wieża kruszyła się od podstawy w gruz, a 60 / 120 Hz rozjeżdżały się o 35%.
- FRONT startuje przy ISLAND v3 = 1 (> 3 bloki, od budowli) albo po pęknięciu przegubu kątem — tylko z kikutem tuż pod wyspą: `structureStartFront` + najniższa kondygnacja wyspy w gruz (model 1-D liczy spód od jej stropu), poza kinematyczna z F.s, bez par. Koniec: FRONT_GROUND / FRONT_STOP, najniższy punkt na podłożu albo kondygnacja pod frontem nie jest już kikutem (`wyspa`).
- Wieże sceny A/B mają tę samą fazę grafu (`id` → (id + tick) mod okres) — inaczej historia zerwań przesuwa się o krok.
- Encja-lustro klastra to klasa z wszystkimi polami z góry (`CollapseEntity`): `syncSolidOut` pisze pozę co krok, a literał z dopisywanymi polami przechodził w tryb słownikowy.
- Oś czasu: oderwanie (wyspa ≥ 30% budowli, zawias albo front), zawias, przegub (`kat` / `zastoj`, przechył przy pęknięciu), przechył w czasie (co 0,05 s), 40°, front (poziomy, koniec), dach na ziemi = narożnik bloku POZIOMU DACHU ≤ 60 j. nad podłożem (uskok ×0,76 — dach leżącej wieży wisi ~45 j. nad gruntem) albo cały poziom dachu w gruzie (lądowanie analityczne, `roofAsDebris`).
- Bez alokacji: krok gospodarza (`collapsePreStep` + `collapseStep`) < 64 B na krok w stanie ustalonym JIT (resztka: dt w argumentach `stepStructure`). Liczby stanu w tablicach typowanych (`H.iv`, `H.fv`, `H.tv`, `rec.f`), podłoże w `H.gr`, wyniki pomocników w `H._t`. `HullBodies.step` w tej scenie alokuje ~3 KB na krok — to silnik, poza gospodarzem (E5).
- Budowla z POLEM PŁYTY (dysk): `createCollapseHost(A, { stumpCollide: false, hinge: false, front: false })` — kikut bez par (stojącą część niesie pole płyty silnika; obraz kikuta nie rysuje), wyspa bez przegubu zawiasu i bez frontu (wycinki płyty to nie kondygnacje — spada swobodnie). Domyślnie wszystkie true (wieżowce bez zmian).
- Sceny dema jako dane: `dema/zawalenia-budowli/scenariusze.js` (sceny 1–5, sterownik salw i ładunków w układzie archetypu, PRNG salwy), `symulacja.js` (sceny 1–3 na HullBodies) i `habitat.js` (sceny 4–5 — § „Pole płyty ↔ graf dysku”). Demo, narzędzie i test liczą ten sam kod; `nadPodlozem` — pomost nad pustką.

## Pole płyty ↔ graf dysku (`src/game/structurePlate.js`, demo D20 krok 5)

- Dysk ma dwie prawdy: POLE PŁYTY silnika (grubość u8, styk z węzłami H-T i punktami klastrów, nośność σ(utrzymanie)) i GRAF E1 (`buildDiscArchetype` — co trzyma, pęka i odpada; wyspy → klastry-wycinki przez gospodarza). Wiązanie (odpowiednik `plateBindGraph` / `_plateKillBlocks` prototypu E1 dla pola silnika):
  - `discPlateOptions(A, { origin, yaw, sigmaHeld, sigmaFree, massUnit })` / `annulusPlateOptions(…)` — opcje `engine.addPlateField` (siatka jak E1: ⌈2·rOut / 45⌉ + 2, dysk 89² — 5416 komórek, tarasy z `PIRATE_BASE_SPEC`, σ silnika = σ_E1 × 45², masa komórki = masa grafu / komórki × 45²);
  - `createPlateBinding(F, S, { origin, yaw, massUnit, hooks })` — komórka → blok górnej warstwy (najbliższy w rzucie) + bliźniak dolnej; instaluje `F.onContact` / `F.onCellLost` (hooks: false — wołający woła haki sam);
  - `plateOnContact` — reakcja płyty −n·j / 45² po blokach części zakotwiczonej w komórkach styku (`F._cells` — ważne tylko w haku; blok poza kikutem → bliźniak, bez obu — przepada);
  - `plateOnCellLost` — otwór bloku + rekord obrazu (`plateRecords`, pierścień: punkt, prędkość zjedzonej masy, masa); `plateKillBlocks` — blok z ≥ 60% otworów ginie z bliźniakiem (zmiażdżony);
  - `plateSync` (po zmianie `S.topoVer`) — komórka zostaje, póki blok górny albo dolny jest w części zakotwiczonej; inaczej znika (`PLATE_HOLE.KILLED` / `DETACHED`); `plateClearIsland(Pb, id)` — wprost dla wyspy; `plateClearUnder(Pb, ciało)` — komórki pod punktami NOWEGO klastra wyspy (komórka należy do najbliższego bloku, punkt do prostopadłościanu — na granicy wycinków spadająca wyspa zgniatała komórki sąsiada: otwory bez uderzenia);
  - `plateStep(Pb, dt, tick, H)` PO `collapseStep` (przegląd otworów co 4 kroki 1/120 s, `plateSync`, `plateClearUnder` nowych klastrów gospodarza `H`); kolejność kroku: `plateSetHold` → `collapsePreStep` → `HullBodies.step` → `collapseStep` → `plateStep`;
  - `plateSetHold(Pb, h)` (zegar D8): `S.hold = h`, a `F.hold` tak, żeby LINIOWA nośność silnika dała σ z okna smoothstep `plateSigma` E1 (holdFree 0,1 / holdHeld 0,5);
  - odczyty: `plateStats` (otwory zgniotu, reszty zabitych bloków, zdjęte z wyspami, rów, utracone bloki grafu), `plateHoleIoU(Pb, x, y, r, 'przebicie' | 'wszystko')` — otwór „przebicie” = komórki zgniecione do zera + reszty bloków zabitych otworami (bez komórek wysp).
- Haki i `plateStep` bez alokacji (test). Moduł czysty (strażnik `structureZasady`), importuje tylko `structureGraph.js` i dane układu.
- Wynik sceny 4 (H-T z gry, 60 Hz; liczby — `node scripts/zawalenia-sym.mjs --scena 4,5`): wieża dochodzi do dysku przy utrzymaniu 0 (~1000 j/s), otwór w kształcie talerza (IoU z pierścieniem 560–880 ~0,9), mija dysk z ~1100 j/s. Cały pierścień 0 grafu ginie (talerz 480…~1000 nakrywa go w całości), więc reszta dysku odrywa się JEDNĄ wyspą tuż po przebiciu i spada od spoczynku — na skale ~3,6 s po wieży (D22). Podpory 0,25 / 0 (panel): dysk puszcza przy utrzymaniu ~0,1 PRZED wieżą i dolatuje razem z nią — dlatego `supportHoldFloor` 0,5.
- Scena 5 (szyja, utrzymanie 1): uderzenie talerza zgniata komórki (ciśnienie ≫ σ_held na małym polu styku) — rów bez otworu, graf traci 0–1% bloków. Znana luka 60 / 120 Hz (test `todo` w `structureGraph` — E6): przy 120 Hz graf dysku traci w szyi 13% bloków (×3 przechyłu — cały dysk), przy tej samej historii impulsów płyty.
- H-T sceny 4 bez par od pierwszego styku z polem do minięcia dysku: wyspa dysku rodzi się wokół talerza (pierścień 1 zachodzi na talerz do r ~1000), klaster × belki zgniatałby wieżę w przenikaniu. Po minięciu — klaster (D6) z parami i g 400.

## Demo D20 — obraz (`dema/zawalenia-budowli.html`, `.js`, `dema/zawalenia-budowli/obraz.js`)

- Cienka powłoka nad `symulacja.js`: pętla stałego kroku 60 Hz (`?physHz=120`), interpolacja póz klastrów (poprzednia poza zapisana PRZED każdym krokiem, `savePoses`), efekty z pierścienia rekordów gospodarza (`consumeRecords` po każdym kroku). Sceny startują same, przewinięte pod kurtyną o `cfg.przewin` (kroki fizyki + efekty krokiem fizyki) — smugi i przechył widać w pierwszej klatce.
- Obraz z niczym się nie zderza: bloki = pozy klastrów (`H.own[b]` → `H.cls[k].body`, świat bloku = pos + R·(środek − com)), martwy blok (`S.dead`) — macierz zerowa; gruz obrazu (kamienie, CPU), pył (sprite'y, opada w próżni ułamkiem g), smugi i błyski (addytywne, HDR) nie ruszają grafu ani klastrów.
- Własny `WebGPURenderer` (dozwolony w `dema/` — strażnik jednego renderera skanuje `src/`), wyłącznie TSL; niebo i post z `dema/halo_ring_demo_env.js`. Jeden `InstancedMesh` bloków wszystkich gospodarzy + sceneria (płyty, pomost, okręt-zastępstwo) w tym samym rysunku. Rozgrzewka: pule z licznikiem ≥ 2, `compileAsyncNaCelu` każdą kamerą (perspektywa, ortho), 2 klatki pod kurtyną (cień, bloom); licznik pipeline'ów synchronicznych od końca rozgrzewki — 0 (także po zmianach scen, w trybie żywym i w interakcjach sceny 2).
- Atrybuty instancji zmieniane w biegu: `instancedBufferAttribute(InstancedInterleavedBuffer)` i `needsUpdate` na TYM buforze. Węzeł z `BufferAttribute` kopiuje się do własnego `InterleavedBuffer` (three r183 `_getBufferAttribute`) — `needsUpdate` atrybutu nic by nie wysłał.
- Scena z-up: `HemisphereLight` dostaje `position (0, 0, 1)` (three bierze „niebo” z +y). ACES gry ściska ciemne tony — cień na gruncie bez mocnego otoczenia wychodzi czarny.
- Okręt sceny 2 nie ma fizyki: stoi 450 j. w bok od linii strzału (leżąca wieża nie przechodzi przez niego). LPM i salwa F idą przez `collapseWeaponHit` w następnym kroku (kolejka `manual`); trafienie w oderwany klaster to sam obraz (zapytania broni klastry mijają). Zmiana strony w scenie 2 — `sym.bateria({ strona, auto })` od chwili `sym.t` (bez nadrabiania strzałów); w scenie 1 zmiana strony, g, κ i auto-salwy restartuje scenę (A/B).
- Sceny 4–5 (habitat): PŁYTA = siatka co ½ komórki w dwóch arkuszach, tekstura RG8 z pola (R grubość, G materiał), próbkowanie dwuliniowe — kontur otworu i brzegu w G = ½ (gładki, bez schodków po 45 j.; `maskNode` — także w passie cienia), wierzch = średnia grubość komórek z materiałem (R / G — rów zostaje rowem), opada do spodu tuż przy konturze (ściana); dwie siatki (dysk 96², korona 48²) i ich materiały istnieją od startu (rozgrzewka), scena podaje pole (`setScene({ plateFields })`). Stojącą część dysku rysuje płyta — kikut gospodarza bez obrazu (`hideStump`), wycinki — bloki. H-T: siatka brył sceny gry (`dryDockChunkSolids` → trójkąty, barwa per trójkąt rozłożona na wierzchołki) w układzie F wokselizacji, poza z `towerPose` sceny (bryła belek albo klaster D6 — ten sam początek F, interpolacja jak klastry). Lina windy (D17): odcinek bloku-kotwicy (pierścień zewnętrzny) do skały w dwóch slotach instancji bloków — jedzie z wycinkiem, znika z blokiem.
- `window.__zaw` (`?test=1` — zegar ręczny): `ready`, `scene(n, opts)`, `runFrames(n, fps)` (kroki fizyki z `round(t · HZ)` — bez gubienia kroku na sumie 1/60), `render()`, `camera(nazwa)`, `shootWorld`, `salvo`, `side`, `bridge`, `timeline()`, `stats()` (`syncPipes`, rysunki, efekty, `krokMs`), `tune`. Narzędzia widzą renderer jako `window.__HARNESS_RENDERER__`.

## Klastry sztywne i pole płyty (E2)

- Oderwana masa zawalenia to ciało silnika `rigid`: 6DoF w tej samej liście `bodies` co bryły (`integrate`: grawitacja, studnia z `vmax`, przeguby).
  - Kształt = punkty styku (kule) bloków z `buildClusterDesc`: odstęp ≤ 50 j., promień 0,6 × odstęp (węzeł 15 j. nie przejdzie między punktami, R11).
  - Promień ≤ max(najmniejsza półoś, ½ środkowej), czyli najcieńszy wymiar ma co najwyżej jedną warstwę. Inaczej długi blok był wałkiem z kul i toczył się bez snu.
  - Masa i tensor liczone z bloków, bez węzłów i belek (`nodeStore` null).
- Gra:
  - `HullBodies.createCluster(encja, opis, opts)` — encja-lustro jak wrak bryły: `solid3D`, `rigidCluster`, `syncSolidOut`;
  - `clusterCount`, `freezeCluster`;
  - hak `onClusterContact(encja, hull, blok, jx, jy, jz, x, y, z)` w świecie gry (y w dół): blok = NUMER W GRAFIE (`id` z opisu bloków), impuls tego jednego ciała;
  - ROZDZIELACZ haka (`installClusterContactRouter` / `uninstallClusterContactRouter`): hak jest jeden, budowli wiele. Gospodarz ustawia encjom swoich klastrów (także zamrożonemu kikutowi) `entity.collapseHost = H` z metodą `H.onClusterContact` o tej samej sygnaturze (9 argumentów, świat gry) i instaluje rozdzielacz — idempotentnie, można przy każdym `createCluster`. Encja z gospodarzem → tylko gospodarz; reszta → hak sprzed instalacji. Nie nadpisuj `onClusterContact` wprost, gdy działa gospodarz;
  - `clusterJoint(encja, x, y, z, { breakTilt, up, breakForce, name })` — zawias wyspy (zdarzenie HINGE), świat SILNIKA (x gry, −y gry, z) jak opcje `createCluster`. `breakTilt` w RADIANACH (stopnie grafu × π / 180; wartość skończona spoza 0…π → `RangeError`), `up` normalizowane (domyślnie +z, przy studni / ringu −ĝ). Pęknięcie: silnik zdejmuje rekord z `body.joints`, `joint.broken` zostaje w rekordzie — gospodarz czyta go po kroku. Śpiący / zamrożony klaster się budzi, klaster z przegubem nie zasypia;
  - `driveCluster(encja, pos, vel, angVel, { gravity })` — jawne API ruchu klastra dla gospodarza (front zgniotu, wyspa wolna): świat silnika, `pos` = środek masy, null = bez zmiany, obrót zostaje. `gravity`: true / brak — grawitacja i studnia z chwili `createCluster`; false — bez obu (front niesie ciało); liczba g → {0, 0, −g}; wektor. Budzi, `_touchGeometry`, lustro encji od razu; bez alokacji (test w `beamRigid3DAlokacje`), `opts` — stały obiekt wołającego. Klaster jest lustrem silnika, więc reguła „gra rusza encję, nie `body.pos`” idzie przez to API, nie przez zapis ciała;
  - tłumienie obrotu klastra `createCluster(…, { angularDamping })` → pole ciała `angularDamping` (null = `cfg.angularDamping` 0,2/s; statki i bryły mają null — bit w bit). Decyzja (D20 krok 3): klastry zawaleń zostają przy null — A/B `zawalenia-sym.mjs --tlumienie` zmienia czas „dach na ziemi” o 1–6% (plan § 6.2);
  - mnożnik tłumienia SPOCZYNKU i TOCZENIA w styku `createCluster(…, { restDamping })` → pole ciała `restDamping` (null = 1: `restDamp` pary, `restAngDamp` terenu, `rollDamp` — bit w bit), w biegu `HullBodies.setClusterDamping(encja, angular, rest)` (undefined — bez zmiany). To tłumienie działa przy ≥ 2 stykach bez progu prędkości i zabijało przewracanie wieży po narożniku przy niskim g (dziesiątki sekund) — gospodarz zdejmuje je (0) na czas przewracania;
  - zapytania broni (`sweep`, `impact`, `cutSegment`, …) klaster dziś MIJAJĄ.
- Prawo styku:
  - klaster × klaster i klaster × teren — impulsy sekwencyjne na styk;
  - normalna terenu RAZ na ciało; odczyt promienia pod punktem tylko poniżej płaszczyzny stycznej + `terrainSlope` (1) × odległość w bok, bo rzeźba wystaje nad płaszczyznę;
  - pamięć odczytów na TEREN, nie na ciało; teren 4 przejścia impulsów, tłumienie toczenia `rollDamp`;
  - klaster × ciało belek — impuls zbiorczy do granicy plastyczności frontu ciała belek (prawo v2). Ponad nią zgniot TYLKO ciała belek (taran D5) i CCD punktów przy dużej prędkości;
  - siatka par klastrów — bok 2,5 × średni promień.
- Sen po ruchu NETTO pozy; śpiący klaster jest podporą. Budzą go:
  - styk albo sąsiad szybszy niż `wakeSpeed`;
  - PCHANIE — impuls w bok ponad tarcie podparcia, zebrany w serii kroków, większy niż masa × `pushWakeDv` (statek pcha gruz);
  - UTRATA PODPORY (`supportLost`): partner styku z ostatniego kroku na jawie jest martwy, nieobecny w kroku, ruszył albo stracił węzły; teren zdjęty; komórki płyty pod nim cieńsze. Sprawdzane przy zmianie `F.version` i co `supportPeriod120`; zamrożony klaster wtedy odmarza. Nowa ścieżka usuwająca podporę nie musi nic wołać.
- POLE PŁYTY (`engine.addPlateField`):
  - statyczna siatka komórek (u8 grubości, 0 = otwór); w warstwie płyty działa węzeł bryły belek albo punkt klastra;
  - ciśnienie ponad nośność σ = `capacityFree + hold · (capacityHeld − capacityFree)` zjada grubość, a zjedzona masa przejmuje prędkość;
  - REAKCJA NA CAŁE CIAŁO: węzły nieruszone, solver nie budzony;
  - haki `onCellLost` / `onContact`, bilans pędu `stats.j − stats.p`;
  - jednostki: σ silnika ≈ σ grafu × masa węzła (45). Wieża 43 mln przy 900 j/s przebija płytę 360 j. przy σ ≲ 2·10⁴ — strojenie w E6.
- Rozgrzewka JIT `HullBodies.warmUpClusters()` → `D.warmUpRigid()`:
  - ~110 ms raz na proces; stan systemu wraca (listy, haki, liczniki, znaczniki, numeracja ciał) — pilnuje `tests/beamRigid3DRozgrzewka.test.mjs`;
  - NIE w `init`, bo `init` idzie przy pierwszym kadłubie gracza;
  - wpiąć na ekranie ładowania razem z pierwszym `createCluster` w grze (E5) i powtórzyć z nią złote testy (przechodziły z nią w `init`);
  - bufory kroku na 256 klastrów (`rigidReserve`) przed krokami rozgrzewki.
- Otwarte (E6 / E7):
  - para klaster × bryła belek: 7–9 µs na wywołanie i 23–34 µs na parę ze stykiem, z wczesnym wyjściem bez węzłów w obrysie (bramka 1,5 µs spełnia tylko klaster × klaster);
  - taran klaster × ciało płaskie: 10–25 µs na parę;
  - resztkowe alokacje w parze z ciałem belek (~5 KB / 60 kroków) i w płycie (~4 KB);
  - sufit 160 aktywnych dochodzi z opóźnieniem (zimny szczyt 199);
  - broń wobec klastra, pękanie klastra po wiązaniach, CCD z obrotem.

## Przy wpinaniu w grę (E3–E7, plan § 3.6–3.8)

- Gra ↔ render:
  - pozy klastrów idą lustrami brył (`BODY_FLAG.RIGID` — worker rysuje klaster partią, nie skórą belek);
  - stan budowli to blok migawki `structBlock` (wzór `worldBodiesBlock.js`), nie pola encji;
  - zdarzenia to rekordy `STRUCT_SPAWN / RELEASE / CRUSH / CARVE / RUIN / RESTORE` z zakresu świata (wolne 78–111 i 116–127), `ROCK_DENT` w torze skały 113–115;
  - pierścień rozkazów ≥ 64 tys. słów od startu, bo `_grow` alokuje SAB w klatce;
  - czas gruzu z `SimClock` (pauza go zatrzymuje), pozy z `Core3D.frameNowMs()`;
  - ukrycie: `prov.hidden()` i `HIDDEN_KEEP_MS`;
  - sufit `szewRenderu` rośnie o 2–3 z powodem w linii sufitu; `off` ≡ worker.
- Budżet GPU zawaleń (E0, plan § 6.2): w upadku habitatu przy Ultra szczyt dają gaz i wybuchy (`fx:wybuchy` 5–6 ms na klatkę w locie z łańcuchem wybuchów), nie rysunki brył (render 2,7–4,4 ms przy 190–330 rysunkach). Nowe efekty zawaleń (pył, gruz) liczą się z tym samym budżetem — pył cząstkami (D2).
- Haki:
  - zawalenie bazy zgłasza graf przez `pirateBaseWorld` (`collapsePirateBaseChunk`: `_dockGone`, `noteBaseChunkBreak`, `markBaseBroken`, `pirateBaseObstacles`), bez `breakPiece`;
  - klastry w ruchu → indeks wraków; ruina → `statics` (jeden przyrost `staticsVer` na partię). Pętle gry po wrakach i ciałach (AI, celowanie, zimne wraki) muszą rozpoznać klaster (`rigidCluster`) — hak przekrojowy w AGENTS.md dochodzi razem z E5;
  - `STRUCT_CRUSH` → `RepairSwarm.blast`, poza bazą także `damageTrafficActor`;
  - pule L2, żwiru, cząstek i kul kraterów w presetach `graphicsQuality.js`;
  - światła iglicy przypięte do bloku L1: jadą z klastrem albo dostają `intensity = 0`;
  - obraz: kotwica soczewki skoku, offset w `mesh.position`, `updateMatrixWorld`, `sunVisibility`;
  - wszystko w `Core3D.warmup` (`'loading'`: materiały × BG/FG × indeks × `discard`, gruz z `WARIANT_INSTANCJI`, kernele w `warm`);
  - klastry nie są zimnymi wrakami; maskowanie — klastry ranią jak taran.
- Broń: stojąca budowla dostaje krater w ciele pasa i falę w konstrukcji (`structureHit`), nie HP bloków (D4). Oderwany klaster: punkt styku → HP bloku + `STRUCT_CARVE`; wiązka i Hexlance (`plowLance`) po promieniu; do tego rakiety, fala i taran. Miejsce HP bloku — do ustalenia w E5.
- Fabuła: „zniszczony” wieżowiec = HP 0 albo utrata nośności przekroju (pęknięty zawias, ruszony front). Oderwany panel się nie liczy, etap liczy się raz. `collapse` przy HP 0 = graf z utrzymaniem → 0. HP 0 poza bańką 7 km aktywuje graf bez ciała pasa.
- Wycofanie (plan § 3.8, do E7 za `?zawalenieStare=1`, potem usunięcie):
  - `_chainExplosion` przy terenie skały — zostaje `habitatFall()` i wybuch szyi;
  - z `pirateBaseFall.js`: korek, `openDiscHole`, `releaseDisc` i `disc*`, `towerTumblePass`, fazy studni, `holdGravity`, `towerKick`, `plug*`, `promotePlanarPiece` przy HP 0;
  - `DISC_PIN_GRID`, a u wieżowców `baseBreak` + `breakPiece` i pełnowysoka skóra `skin`.
  - Zostają: `_habitatImplosion` tylko dla atrapy bez terenu; `sweepTowerColumn` za flagą do pomiaru v_odłamu / v_wieży ≤ 1,05; `debrisGate` do E7 (potem `onNodeDebris` → pula gruzu).

## Strojenie (stan dzisiejszy)

- `STRUCT_TUNE` i `A.tune` są zamrożone. Archetyp liczy z nich kalibrację (`E`, `u0`, `spread`, podłogi `floor*`, `tensionFrac*`, `shearFrac`). Krok czyta resztę: `shearK` / `shearMech` w prekondycjonerze, `critMul` w kontroli przekrojów, falę, zmęczenie, zawias i front.
- Zmiana = przebudowa archetypu: `build…Archetype({ tune, g })` / `finishArchetype(B, { tune, g })`, w narzędziu `struktura-sym.mjs --set klucz=wartość`. Nie mutuj `STRUCT_TUNE` ani `A.tune` i nie dawaj wspólnego mutowalnego obiektu na wzór `window.BaseIntegrityTune` — rozjechałby egzemplarz z kalibracją i dzieliłby stan między testami.
- Wartości na wywołanie są już dziś:
  - `structureStartFront(S, wyspa, v0, { kappa, debrisFrac })`;
  - `structureHit(…, { radius, waveRadius, decayZ })`;
  - `structureSetHold`;
  - `structureSolveIsland(S, id, maxIters)`.
- Klastry: `D.rigidConfig` (`wakeSpeed`, `pushWakeDv`, `rollDamp`, `terrainSlope`, `supportPeriod120`, `sleepTicks120`, …). W grze `maxActive` i `friction` nadpisuje `HullBodies.init` z `HULL_BODY_CONFIG.clusterMaxActive` / `clusterFriction`; w narzędziu `klastry-sym.mjs --budzet N`. Pole płyty: pola obiektu pola `capacityFree`, `capacityHeld`, `hold`.
- Plan (D20 / E5):
  - uchwyt `window.StructureTune` tylko z konsoli, bez suwaków w panelu F12 i bez nakładek;
  - składa go demo D20, a w grze `index.html` (blok bazy piratów, obok `window.BaseIntegrityTune`) z egzemplarzy, które ma. Moduły gry nie piszą do `window`;
  - klucze biegu egzemplarza (`S.tune`, domyślnie ten sam obiekt co `A.tune`) wchodzą z pierwszym konsumentem, razem z testem „klucz biegu nie zmienia kalibracji”.

## Testy

- `tests/structureGraph.test.mjs`:
  - bramki E1: kolumna, wspornik, podcięcie ±x, D11 na W-1 / W-2 × strony × ziarna, ciężkie uszkodzenia, okno impulsu, kondygnacja 15, plaster, front κ × gruz, fala, wyspa swobodna, próg dysku;
  - determinizm 3× (z archetypem budowanym po innych testach i po `structureReset`), 60 / 120 Hz ±5% (szyja dysku — `todo` do E6), budżet zerwań i rekordów;
  - g archetypu: złote hasze FNV limitów, ciepłego startu i zdarzeń podcięcia z falą przy g 400 (zmiana kalibracji = świadoma aktualizacja haszy); przy g 80 i J × g/400 te same zdarzenia co przy g 400;
  - prostopadłościany: Σ mas = masa bloku, narożniki w L, opis klastra (masa × 45²), SAT bez nachodzenia różnych bloków, obrys (testy dopisane NA KOŃCU pliku);
  - test alokacji jest PIERWSZY w pliku, bo inne testy robią miejsca wywołań polimorficznymi;
  - progi czasu tylko z `WYDAJNOSC`.
- `tests/beamRigid3D.test.mjs`: opis klastra, masa, studnia, teren, stos, pęd, BIT W BIT, taran, R11, bryła belek, zawias, hak grafu, zamrożenie, determinizm 60 / 120 Hz, budżet aktywnych, `createCluster`, sen długich klastrów, dwa tereny, garb, pchanie, utrata podpory; API gospodarza: `clusterJoint` (pęka przy 40° w radianach, stopnie → błąd, `up` normalizowane), tłumienie przy g 80 (A/B kroków do 40°), `driveCluster` (grawitacja wył. / z utworzenia / g / wektor, studnia, budzenie, lustro), rozdzielacz haka (gospodarz kontra cudzy hak, odbite y, instalacja i zdjęcie), `body.angularDamping` (null bit w bit z konfiguracją). Testy HullBodies na końcu pliku zaczynają od `HullBodies.ready = false; init()`, bo `gameConfig` innych testów zeruje haki silnika.
- `tests/structureCollapse.test.mjs` (prawdziwy HullBodies + rozgrzewka, ~3 s): kikut bez przenikania, D11 ±x / ±y (ruina ku stronie ostrzału), sufity klastrów, nic głębiej niż 2 promienie pod podłożem, przegub 40 ± 3° na pomoście i zastój na gruncie, front κ 0,2 / 1 i kikut znika w kroku FRONT L, respawn (pęd i moment ±1%), impuls wyspy po ocenie części zakotwiczonej, D12 g 80 / g 400 w 2,0–2,6, te same zerwania przy g 400 i 80 do oderwania, spoczynek po 30 s, 60 / 120 Hz ±10%, determinizm 3×, krok gospodarza < 64 B.
- `tests/structurePlate.test.mjs` (prawdziwy HullBodies, H-T z gry, ~3 s): mapowanie utrzymania (liniowa nośność silnika = `plateSigma` × 45²), wiązanie komórek (5416, bliźniaki), impuls styku do grafu (udziały), otwory ≥ 60% → blok z bliźniakiem, `plateSync` / `plateClearIsland`, bilans pędu pola w każdym kroku (z tłumieniem liniowym `integrate`), UPADEK (utrzymanie 0 przy dojściu, IoU ≥ 0,7, wieża traci część pędu), D22 (wieża pierwsza na skale, wycinek ≥ 2 s później, dysk nie puszcza przed stykiem), SZYJA (0 otworów, rów > 0, ≤ 5% bloków — D7), haki bez alokacji.
- `tests/beamRigid3DAlokacje.test.mjs` — osobny proces; ścieżki z ciałami belek w jednym procesie z innymi testami dają 37–58 KB. Próg 8192 B / 60 kroków mieści znane resztki. `driveCluster` — ostatni test pliku (przestawia silnik na konfigurację gry), 600 wywołań na pomiar, bo przy 60 jedna liczba pakowana na wywołanie ginie w narzucie pomiaru.
- `tests/beamRigid3DRozgrzewka.test.mjs` — rozgrzewka JIT bez śladu: pola systemu przed i po, kolejne id ciała, hasz sceny kontrolnej (bez id) 2× przed i 1× po; osobny proces, bo rozgrzewka idzie raz na proces.
- `tests/beamPlateField3D.test.mjs`.
- `tests/structureZasady.test.mjs` — gra nie losuje, bez three / DOM, importy (także przechodnio bez three), zegar tylko w `nowMs`, `Math.hypot`; dla `src/game/structure*.js`, `beamRigid3D.js`, `beamPlateField3D.js`.
- `tests/structureZegar.test.mjs` — przy `timing` false 0 odczytów zegara; przy `timing` true i zegarze przesuwanym przy każdym odczycie wynik bit w bit (podcięcie W-1 z wyspą swobodną, stos klastrów na terenie, klaster na płycie).
- Testy nie mierzą czasu ściany. Odporność sprawdzaj tak:
  - `WOLNY_ZEGAR_MS=5 node --import ./scripts/wolny-zegar.mjs --test "tests/structure*.test.mjs" "tests/beamRigid3D*.test.mjs" tests/beamPlateField3D.test.mjs` (0 / 2 / 5 / 10 ms);
  - `node --concurrent-recompilation-delay=200 --test …` (alokacje do stanu ustalonego JIT, `untilSteady`).
- Testy innych obszarów, które zmienią się przy wpinaniu (etap i przyczyna), są w plan § 6.1. Przy każdym etapie aktualizuj je razem z kodem, nie wyłączaj.

## Narzędzia

- `node scripts/struktura-sym.mjs --tryb podciecie|zawias|wspornik|kondygnacja|front|fala|ciezkie|dysk-szyja|dysk-upadek|prog|koszt [--dt 120,60] [--kappa …] [--gruz …] [--hold h] [--ziarno N] [--set klucz=wartość]` — graf w Node: oś czasu zdarzeń, bramki E1, koszt kroku. Wieżowiec 0,03 ms średnio, trzy grafy misji naraz max ~1 ms; bramka w Chrome — E5.
- `node scripts/zawalenia-sym.mjs [--scena 1,2,3] [--g 400,80] [--hz 60,120] [--strona +x] [--kappa …] [--tlumienie 0|1] [--kontakt 0] [--zakleszczenie N] [--pomost -y@4] [--set klucz=wartość] [--log 1] [--json]` — sceny dema na gospodarzu i prawdziwym HullBodies: oś czasu (oderwanie, zawias, przechył w czasie, przegub, front, dach na ziemi), kawałki, koszt kroku p50 / p95 / max (fizyka / gospodarz / razem). `--zakleszczenie N` — N ziaren salwy × 4 strony; `--kontakt 0` — A/B bez tłumienia spoczynku / toczenia silnika. Sceny habitatu: `--scena 4,5 [--podpory 0.5,0.25,0] [--ht belki|klaster] [--mocniej 1,3]` — oś czasu D22 (styk, przebicie, minięcie dysku, wieża / wycinek na skale), IoU otworu, otwory, rów, utracone bloki, korona. Zostaje na E5.
- `node scripts/webgpu/zawalenia-demo.mjs [--sceny 1,2,3,4,5] [--chwile 0,1,3,5,8,12,16] [--kamery kino,gora,profil,sledz,podstawa,dach,gruz] [--out .tmp/zawalenia-demo] [--node 0] [--interakcje 0] [--panel 0]` — demo w headless Chrome w tle: kadry scen w chwilach pokazu, arkusze `arkusz-s<n>.png`, oś czasu przeglądarki porównana z `zawalenia-sym.mjs` (ma być identyczna), interakcje sceny 2, kadr z panelem w trybie żywym, pipeline'y synchroniczne (dema i dziennika `harness-strona.js`), błędy konsoli i walidacji WebGPU. Gra użytkownika w tle → pomija (kod 0), cudzy harness → kod 2 (`--wymus 1`).
- `node scripts/klastry-sym.mjs --tryb stos|plyta|taran|bryla [--n 100,200,256] [--powt 3] [--hz 60] [--json] [--budzet N]` — klastry w prawdziwym `HullBodies`. `--czasy 0` — bez czasów modułów, jak w grze. Zimny pierwszy krok mierz osobnym uruchomieniem z `--powt 1`.
- Upadek habitatu i baza (reguły `kadluby-belki`, `baza-piratow`):
  - w Node: `node scripts/destrukcja-taran-sym.mjs --tryb upadek [--ziarno 12345] [--prebuild 1] [--pct 1] [--koszt 1]`;
  - w grze: `scripts/webgpu/upadek-gra.mjs`, `gpu-baza-gra.mjs` (sonda GPU na klatkę; `--odmroz 1` odmraża świat po podsumowaniu misji), `baza-zniszczenie-gra.mjs --tryb etapy`, `zniszczenia-gra.mjs --final`.
  - Pomiary czasu i GPU — przy ciszy innych sesji, headless w tle, A/B po kolei.
- Dane i benchmark panelu z 2026-11-03 (poza gitem): `.tmp/destrukcja-2026-11-03/` (`bench/`, `weryfikacja/`, raporty).
