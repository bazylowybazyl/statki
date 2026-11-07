# Mapa gwiezdna — strefa międzygwiezdna (plan i stan, 2026-11-07)

Stan: moduł danych `src/game/sector/` + demo `dema/mapa-gwiezdna.html` do oceny przez użytkownika. Do gry NIE wpięte
(propozycja wpięcia — § „Wpięcie w grę”). Reguła obszaru: `.claude/rules/mapa-gwiezdna.md`.

## Po co (decyzje użytkownika 2026-11-07)

- Zamknięcie w jednym układzie szkodzi eksploracji („gracz nie pójdzie w nieznane”, przykład Starsectora).
- Układów DUŻO, bo zwiedzania ma być dużo. „Nebule już prawie są — trzeba stworzyć gwiezdną mapę, po której się będzie
  poruszał gracz”; „podróżuje się podobnie jak Starsector — zrobimy przejście do strefy międzygalaktycznej”.
- Gospodarki układów niezależne (bez gracza uproszczone); między układami ruszają się tylko floty kupieckie i wojsko.
- Układy nie leżą w jednej przestrzeni świata (float32: przy 100 mln j. krok 8 j.) — każdy ma własne pudło 0–12 mln j.;
  przejście do układu = przeładowanie strony z id układu (analiza orkiestratora).

## Pliki

| plik | co |
|---|---|
| `src/game/sector/sectorRandom.js` | losowość z ziarna: `hashU32` (strumień na cel), `SectorRng`, `rngStep` (stan w rekordzie floty), `valueNoise2` / `fbm2` (szum mgławic) |
| `src/game/sector/sectorStars.js` | klasy gwiazd (O, B, A, F, G, K, M, czerwony olbrzym, biały karzeł, neutronowa): barwa, strefa życia, promień tarczy w świecie układu, wagi, podwójne 9% |
| `src/game/sector/sectorBodies.js` | skrót zawartości układu: planety `{ id, type, seed, orbitAU, r }` z rodzajami wspólnymi z generatorem planet, pasy; Układ Słoneczny z `SYSTEM_MAP_PLANETS` |
| `src/game/sector/sectorGen.js` | `generateSector({ seed })`: układy, rdzeń / pogranicze, frakcje, mgławice i burze, szlaki, bramy, kryjówki piratów; `sectorSummary`, `lanePath` |
| `src/game/sector/sectorZone.js` | warunki strefy w punkcie (`zoneAt`: mgławica, burza, wiatr), punkty skoku, przejście strefa ↔ układ (`worldEntryFromJump`, `zoneExitFromWorld`) |
| `src/game/sector/sectorFlight.js` | lot statku w strefie (`stepShip`), `SECTOR_FLIGHT` (prędkości, paliwo, czujniki, skan) |
| `src/game/sector/sectorExploration.js` | mgła eksploracji (4 poziomy), zapis i odczyt |
| `src/game/sector/sectorFleets.js` | floty między układami: konwoje, patrole, piraci; krok stały 10 Hz, zdarzenia, migawka |
| `src/game/sector/sectorRegistry.js` | opis układu z sektora → wpis rejestru `STAR_SYSTEMS` (`systemRegistryEntry`, `sectorRegistryEntries`, `localBodyId`) — § „Opis układu → wpis rejestru” |
| `dema/mapa-gwiezdna.html` + `.js` | demo: lot, kamera od lotu do całego sektora, nakładka 2D (etykiety, punkty skoku, floty, trasa), HUD |
| `dema/mapa-gwiezdna-obraz.js` | warstwy GPU (three r183 WebGPU, TSL): tło z wypieku galaktyki + gwiazdy ekranowe, mgławice z wypieków, mgiełka rozgrywki, burze, gwiazdy układów, szlaki, post (bloom gry, ACES gry) |
| `scripts/webgpu/mapa-gwiezdna-demo.mjs` | zrzuty dema w headless Chrome (CDP) → `.tmp/mapa-gwiezdna/` + `raport.json` |
| `scripts/mapa-gwiezdna-liczby.mjs` | liczby sektora dla ziaren (odległości, czasy lotu, paliwo, koszt kroku flot) |
| `tests/sector.test.mjs` | determinizm, unikalne id, odstępy, rozkład, rdzeń i szlaki, ciała, strefa, punkty skoku, lot, eksploracja, floty |
| `tests/sectorRegistry.test.mjs` | wpis rejestru: pola jak `SOL_SYSTEM`, `buildSystemMap` na planetach wpisu, orbity za studnią, `globalBodyId` = id sektora, bez przypadkowego ringu, `resolveStarSystemId` |

## Model

### Sektor

- Jednostka strefy: **rok świetlny [ly]**; osie jak gra 2D (x w prawo, y w dół). Słońce w (0, 0), id `sol`.
- Pudło 160 × 100 ly (x −64…96, y −50…50), **160 układów**: 15 stałych (Słońce + 14 prawdziwych sąsiadów: Alfa Centauri
  G+K, Gwiazda Barnarda, Wolf 359, Lalande 21185, Syriusz A+biały karzeł, Epsilon Eridani, Procjon F+biały karzeł,
  61 Cygni K+K, Tau Ceti, Epsilon Indi, Gwiazda Kapteyna, Altair, Wega, Fomalhaut — odległości prawdziwe, Altair, Wega
  i Fomalhaut przysunięte do 17–20 ly; kierunek rzutu dobrany) + 145 proceduralnych.
- Rozkład: gęstość = tło 0,035 + 3 RAMIONA (pasma wzdłuż krzywych, jedno przez rdzeń jak Ramię Oriona) + 9 GROMAD
  − 5 PUSTEK, losowanie z odrzuceniem, najmniejszy odstęp 2,4 ly. Wskaźnik rozproszenia komórek 10 ly > 1,3 (test).
- RDZEŃ zamieszkany: nazwani sąsiedzi + proceduralne bliżej niż 21 ly → 26–35 układów (ziarno 1: 27); właściciele —
  frakcje rdzenia (`src/data/factions.js`: Terra Nova — Słońce, Alfa Centauri, Barnard; Stocznie Marsjańskie — Wolf 359,
  Lalande, Kapteyn; Konsorcjum Wewnętrzne — Syriusz, Procjon, Altair; Unia Pasa — Epsilon Eridani, Tau Ceti,
  Fomalhaut; Konsorcjum Zewnętrzne — 61 Cygni, Epsilon Indi, Wega), proceduralne — frakcja najbliższej siedziby.
  POGRANICZE: reszta (~133), bez właściciela; 7 kryjówek piratów 26–60 ly od Słońca (odstęp ≥ 13 ly).
- Id: nazwani — po nazwie (`alfa-centauri`), proceduralni — katalog `hf-NNNN` numerowany od Słońca (bliżej = mniejszy
  numer, nazwa własna z sylab po skanie); planety `<id>:p<n>` (= `globalBodyId(id, 'p<n>')`; Słońce: `sol:earth`),
  pasy `<id>:pas<n>`, mgławice
  `mg-<n>`, burze `burza-<n>`, bramy `brama:<id>` — unikalne w całym sektorze (test dla 4 ziaren).
- Zawartość układu z ziarna (sektor, id układu) — nie zależy od liczby układów ani kolejności generacji. Rodzaj planety
  z temperatury orbity τ = orbitAU / (25 · hz gwiazdy) (τ ≈ 1 Ziemia, 2 Jowisz, 4,8 Neptun); orbity w AU MAPY do 122,
  pas planetoid w przerwie przed pierwszym olbrzymem, pas lodowy 124–140 (jak Kuiper). Ziarno 1: 581 planet.
- Szlaki handlowe: graf Gabriela na układach rdzenia (≤ 12,5 ly) + MST (spójność); najkrótsze trasy `laneNext`
  (ziarno 1: 49 szlaków, najdłuższa trasa konwoju 42 ly / 8 przeskoków).
- Bramy warp: 7 układów rdzenia (Słońce i 6 siedzib) — tylko dane (`sector.gates`); mechanika do decyzji.

### Mgławice i burze

- 14 mgławic (jedna wielka 15–20 ly, jedna graniczna widoczna z rdzenia, reszta 4,5–12 ly), rodzaje: emisyjna,
  pyłowa, ciemna, fioletowa; częściej w ramionach, rdzeń czysty.
- ROZGRYWKA: gęstość d = elipsa z miękkim brzegiem × fbm z ziarna mgławicy; prędkość × (1 − 0,5 d), czujniki
  × (1 − 0,7 d) (patrzącego i celu). Układ pogranicza w mgławicy ≥ 0,55 startuje UKRYTY (ziarno 1: 32 układy).
- BURZE: 7–15 komórek w dużych mgławicach, krążą (okres 70–190 s); w burzy wiatr po okręgu (do 0,12 ly/s), paliwo
  × (1 + 0,8 s), czujniki × (1 − 0,5 s), `hazard` = s (w grze — do decyzji).
- OBRAZ: wypieki stylu „mgławica” (6 wariantów nastaw, 1280 × 800, raz przy starcie) jako duszki w elipsach danych +
  MGIEŁKA ROZGRYWKI (TSL, ten sam szum co `nebulaDensityAt` — port hasza u32) — kształt w detalu z wypieku, granica
  spowolnienia z mgiełki.

### Lot, punkty skoku, eksploracja

| wielkość | wartość |
|---|---|
| prędkość przelotowa / nurt (Shift) | 0,2 / 0,32 ly/s |
| przyspieszenie / hamowanie | 0,09 / 0,16 ly/s² |
| sąsiad: mediana / p90 odległości (ziarno 1) | 4,0 ly = 20 s / 7,7 ly = 38 s |
| Słońce → Alfa Centauri | 4,37 ly = 22 s |
| przez rdzeń (~40 ly) / cały sektor (160 ly) | 3,3 min / 13,3 min |
| paliwo | bak 100, 2 jedn./ly → 50 ly (nurt 25 ly); pusty bak — dryf 0,03 ly/s; tankowanie w studni układu rdzenia (demo) |
| czujniki / skan | 6 ly (× mgławica) / 3,5 ly przez 2,5 s |
| studnia układu (punkty skoku na okręgu) | 0,6 ly, wejście w punkt 0,14 ly |

- PUNKTY SKOKU: cztery na okręgu studni pod 45° — NE / NW / SW / SE, jak rogi kwadratu świata układu (12 mln j.; róg
  ~201 AU mapy od gwiazdy, za Kuiperem 125–140). Wejście punktem NE = Atlas w rogu NE świata, kurs do gwiazdy
  (`worldEntryFromJump`); wyjście z układu rogiem SW = punkt SW w strefie + 0,2 ly na zewnątrz (`zoneExitFromWorld`).
- MGŁA EKSPLORACJI: 0 ukryty (w gęstej mgławicy) → 1 gwiazda (barwa, katalog) → 2 zeskanowany (nazwa, planety, pasy) →
  3 odwiedzony (właściciel, kryjówka, brama). Rdzeń znany od startu (mapy rdzenia).

### Floty między układami

- Ziarno 1: 44 floty — 24 konwoje kupieckie (0,13 ly/s, po szlakach rdzenia, cel wagą handlu: Słońce 5, nazwani 2,5,
  reszta 1; postój 8–22 s), 10 patroli (2 na frakcję rdzenia, 0,17 ly/s, krążą po układach frakcji, ścigają piratów do
  40 s w pobliżu rdzenia), 10 band piratów (0,19 ly/s, zasadzka przy szlaku brzegu rdzenia albo przy układzie pogranicza,
  krążenie 25–50 s, pościg do 30 s za konwojem albo graczem, powrót do kryjówki).
- Starcie (< 0,18 ly): siła + los z ziarna floty; napad → konwój bez ładunku ucieka do najbliższego układu rdzenia;
  patrol vs piraci → przegrany znika i wraca z bazy po 150–300 s; przechwycenie gracza → zdarzenie (w grze: scena walki).
- Widoczność dla gracza: w rdzeniu (promień rdzenia + 3 ly) wszystkie floty w drodze (sieć przekaźników), dalej —
  zasięg czujników × mgławice; flota w porcie (w studni układu) niewidoczna.
- Krok stały 0,1 s (10 Hz), losowanie tylko z ziarna floty → determinizm (test: 300 s krokami 0,1 s = `advanceFleets`
  300 s; migawka → ten sam dalszy bieg). Koszt: **36 µs na krok** (44 floty, Node, mediana) = 0,36 ms na sekundę gry.

## Demo (`dema/mapa-gwiezdna.html`)

- Start: Atlas tuż za punktem NE Układu Słonecznego (jak po wylocie z gry rogiem świata), zoom lotu 190 px/ly; floty po
  90 s rozbiegu. Sterowanie: W / S / A / D, Shift — nurt, kółko — zoom (od całego sektora do 420 px/ly), M — cały sektor,
  LPM — wybór układu (trasa, czas, paliwo), PPM — autopilot do najbliższego punktu skoku układu, E — skok (komunikat:
  `?uklad=<id>&wejscie=<róg>`, bez przejścia).
- Wypieki przy starcie (RTX, headless, 1600 × 900): tło galaktyki 2560 × 1600 ~0,4 s, pierwszy wariant mgławicy ~1,9 s
  (z budową pipeline'ów), kolejne 0,1–0,25 s — razem ~3,1 s; mapa żyje od pierwszej klatki, mgławice dochodzą po kolei.
- Zrzuty: `node scripts/webgpu/mapa-gwiezdna-demo.mjs [--out .tmp/mapa-gwiezdna/<katalog>] [--seed N] [--tylko start,sektor,…]`
  — start, cały sektor, rdzeń, mgławica (cała, w środku, w komórce burzy), punkt skoku i komunikat skoku, pogranicze
  przed i po skanie, pościg piratów, najbliższy zoom; 0 błędów konsoli.

## Opis układu → wpis rejestru (`src/game/sector/sectorRegistry.js`, 2026-11-08)

Rejestr układów gry (`STAR_SYSTEMS`, `src/data/starSystems.js`, reguła `uklady-gwiezdne`): jeden układ na stronę, id ciał
w grze LOKALNE ('earth'), globalny id na mapie = `globalBodyId(idUkładu, idLokalny)` = `<idUkładu>:<idLokalny>`.

- `systemRegistryEntry(sector, id, { handmade })` — funkcja CZYSTA (ten sam sektor i id → ten sam zamrożony wpis):
  - `id`, `name` (nazwa układu), `label` — nazwa WIELKIMI literami (≤ 14 znaków, dłuższa — katalog albo pierwsze słowo:
    'TAU CETI', 'ALFA CENTAURI');
  - `star`: `{ id: 'sun', spectral, r, color: { core, mid, rim } }` — widmo prawdziwe u nazwanych ('G2V', 'A1V'…), u
    proceduralnych klasa + podklasa z ziarna ('K3V', 'K5III', 'DA2', 'PSR'), `r` = tarcza klasy (G = 200 tys. jak
    Słońce, O 300 tys., M 130 tys., olbrzym 380 tys., biały karzeł 60 tys.), barwy tarczy klasy (G = barwy Słońca gry);
  - `planets`: format `systemMap.js` — `{ id: 'p<n>', name: '<układ> b|c|d…', baseR, orbitAU, type, seed }`; `type` z listy
    wspólnej z generatorem planet (obejmuje dawne 'rocky' / 'terran' / 'gas'), `seed` dla generatora; nazwy bez
    'earth' / 'mars' / 'jupiter' (gra dopasowuje po nich ring „Halo” — `normalizeRingPlanetKey`, test); pierwsza
    orbita za studnią gwiazdy w skali Słońca (`minOrbitAu`: tarcza × 1,1 + 60 tys. j., AU mapy = 42 253,5 j.);
  - `moons: []`, `home: null`, `handmade: false`;
  - dodatki (gra może pominąć): `companion` (gwiazda towarzysząca: `{ id: 'sun-b', r, color }`), `belts`
    (`{ id: 'pas<n>', kind: 'asteroid' | 'ice', innerAU, outerAU }`), `sector` (`seed`, `version`, położenie, strefa,
    frakcja, katalog, mgławica, kryjówka piratów, brama).
- Słońce: wpis ręczny podaje wołający (`{ handmade: { sol: SOL_SYSTEM } }`); bez niego `systemRegistryEntry(…, 'sol')` →
  null. Moduł nie importuje `starSystems.js` — rejestr może budować się z sektora bez cyklu importów.
- `sectorRegistryEntries(sector, { handmade })` — cały sektor jako { id: wpis } (kolejność układów sektora);
  `localBodyId('hf-0042:p3')` → 'p3'.
- Sprawdzone testem (`tests/sectorRegistry.test.mjs`): `buildSystemMap(140, { planets, sunRadius: star.r })` na każdym
  wpisie — orbity rosną, każda planeta za studnią gwiazdy (`sunWellRadius`) i w świecie 12 mln j.;
  `globalBodyId(wpis.id, planeta.id)` = id planety w sektorze; `resolveStarSystemId('?uklad=Tau-Ceti', …, wpisy)` wybiera
  układ.
- Do decyzji przy wpięciu: skala świata układu proceduralnego — gra liczy AU z najdalszego pasa (`getOuterAsteroidEdgeAU`
  czyta pasy Słońca); propozycja: układ proceduralny w skali Słońca (`auInWorldUnits` = 42 253,5) i pasy z `belts`
  wpisu. Księżyce — generator sektora ich nie robi (propozycja: księżyce olbrzymów z ziarna planety, kolejny krok).

## Wpięcie w grę (propozycja)

1. **Tabela układów** (`src/data/starSystems.js`, orkiestrator): `STAR_SYSTEMS` = `sectorRegistryEntries(generateSector({
   seed }), { handmade: { sol: SOL_SYSTEM } })` ze stałym ziarnem kampanii (§ wyżej); świat z opisu — planety przez
   generator planet `src/3d/planetGen/` (`type`, `seed`), pasy z `belts`, gwiazda: `star.r`, `star.color`.
2. **Strefa jako tryb strony**: `?strefa=1` (albo `location.kind = 'zone'` w zapisie) ładuje lekką scenę strefy zamiast
   świata układu (bez planet, ringów, stacji, pasa) — obraz jak w demie, przez `Core3D` (warstwy dema → moduł
   `src/3d/sector/` z rozgrzewką; reguła `webgpu-tsl`). Wypieki (~3 s) — cache WebP jak `sky-equirect.webp` albo
   wypiek na ekranie ładowania.
3. **Wyjście z układu**: róg świata za Kuiperem = punkt skoku; gracz w rogu → „opuść układ” → zapis → przeładowanie do
   strefy w `zoneExitFromWorld(sector, id, x, y)`.
4. **Wejście do układu**: punkt skoku w strefie → E → zapis (`uklad`, `wejscie`) → przeładowanie z id układu → Atlas w
   `worldEntryFromJump(róg)`.
5. **Zapis gracza**: `{ sectorSeed, sectorVersion, location: { kind: 'zone', x, y, vx, vy, heading } | { kind: 'system',
   id, corner }, fuel, zoneClock, exploration: serializeExploration(), fleets: fleetSnapshot() }`.
6. **Czas**: po powrocie do strefy floty przewijane o czas spędzony w układzie (`advanceFleets`, np. do 30 min =
   18 tys. kroków ≈ 0,7 s — albo przewijanie rzadszym krokiem).
7. **Starcie w strefie** (przechwycenie przez piratów): mały pusty świat bitwy z flotą bandy, po walce powrót do strefy.
8. **Gospodarka**: konwój, który dotarł do układu, rozlicza się przy wejściu gracza do tego układu (ładunek → rynek
   `addMarket` / `stockDelta`); układy bez gracza — uproszczone (decyzja użytkownika).

## Otwarte decyzje użytkownika (rekomendacja w nawiasie)

1. Rozmiar: 160 układów w 160 × 100 ly, rdzeń ~27 (tak; więcej — przez `count`, gęstość zostaje).
2. Tempo: 0,2 ly/s — sąsiad ~20 s, sektor ~13 min (tak — rząd Starsectora).
3. Paliwo: zasięg 50 ly, tankowanie w rdzeniu (tak + rzadkie stacje paliwowe na pograniczu).
4. Prawdziwi sąsiedzi Słońca w rdzeniu (tak).
5. Bramy warp: natychmiastowe przeskoki między 7 bramami rdzenia za opłatą, dostęp od reputacji frakcji (tak, później).
6. Burze: wiatr + paliwo + utrata gotowości / uszkodzenia jak CR w Starsectorze (tak; dziś tylko wiatr i paliwo).
7. Widoczność flot: rdzeń — wszystkie (przekaźniki), pogranicze — czujniki (tak).
8. Przechwycenie przez piratów → scena walki w strefie (tak, osobny etap).
9. Ukryte układy w gęstych mgławicach (~20% pogranicza) (tak).
10. Konwoje niosą ładunek między gospodarkami układów (tak, etap po wpięciu strefy).
