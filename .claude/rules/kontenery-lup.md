---
paths:
  - "src/game/lootContainers.js"
  - "src/data/lootGear.js"
  - "src/render/blocks/lootBlock.js"
  - "src/3d/cargo/lootContainers3D.js"
  - "tests/lootContainers.test.mjs"
  - "tests/lootRender.test.mjs"
  - "scripts/webgpu/kontenery-gra.mjs"
---

# Kontenery-łup: ładunek zniszczonych statków ruchu, gniazdo ZBIÓRKA (wiązka, drony)

> Reguła obszaru (K1, 2026-10-27). Zasady przekrojowe i indeks reguł: `AGENTS.md`. Propozycja, warianty, plan K1–K5 i decyzje D1–D17: `docs/PROPOZYCJA-kontenery-lup.md`. Manifest encji w protokole bańki — reguła `ruch-banka`; wyposażenie gracza — `statek-gracza`.

## Stan

- Zniszczony statek ruchu gubi 55% ładunku (`LOOT_TUNE.survive` = `PIRACY_MODEL.lootRecovery` — jedna stała dla gracza i piratów AI) jako paczki dryfujące w przestrzeni; gracz zbiera je sprzętem z gniazda ZBIÓRKA do ładowni (`addToPlayerCargo`, limit `cargoCap`), sprzedaje w terminalu. Rozgrywka w 2D (`src/game/lootContainers.js`, czysta); obraz — § „Obraz (K2)”.
- ŹRÓDŁO ŁADUNKU: manifest encji z workera ruchu (`actors.manifests` / `unmanifested`, most `TrafficV2.actorManifests` — tylko zmiany), bo rekord wraku (`tick.wrecks`) przychodzi dopiero po kroku świata (do 5 s). Manifest mają tylko kursy w locie z ładunkiem (bez promów z ludźmi, pustych przelotów i wyprawy górniczej przed urobkiem). Awansowany NPC niesie kopię (`npc.__trafficCargo`), bo po `attach` worker zdejmuje manifest.
- KIEDY (D3): tylko przy zniszczeniu — encja bańki bez awansu (`onTrafficActorDestroyed`, wybuch w miejscu trafienia) i awansowany NPC (werdykt `dead` w `stepTrafficPromotion`). Wysyp przy wyrwie w ładowni żywego statku — K4.
- PODZIAŁ (`planLootSpill`): przetrwa `survive` każdej pozycji, całe sztuki; paczek wg klasy ładowni z masy (`vanClassForMass` → `piecesByClass` 2 / 4 / 6 / 10 / 16), proporcjonalnie do masy towarów (każdy co najmniej jedna), ostatnia bierze resztę. Rozrzut deterministyczny z numeru kursu (`cargoHash01`), bez `Math.random`: miejsce w obrysie, pęd wraku + 40–140 j./s od środka wybuchu, obrót w płaszczyźnie.
- RUCH: dryf bez tarcia, po 20 s tłumienie do 15 j./s; życie ~5 min (`ttl` ± 10%), dalej niż 50 km od gracza — przepada. Pula 256 (SoA, x / y `Float64Array`, usuwanie zamianą z ostatnią); pełna → doklejenie do najbliższej paczki tego towaru, bez takiej — zastąpienie najkrótszego życia. Kontenery to duchy (D11): bez zderzeń i trafień.
- GNIAZDO ZBIÓRKA (`src/data/lootGear.js`; decyzja użytkownika 2026-10-27: „wiązka lub drony”): jeden wybór na kadłub (D14) — pusto, wiązka (`loot_tractor`) albo drony (`loot_drones`, `ready: false` do K3). Bez sprzętu nic się nie zbiera (D15) — HUD podpowiada WYPOSAŻENIE, gdy widoczna paczka jest bliżej niż 4 km. Atlas ma wiązkę fabrycznie (D16: `HULL_LOOT_GEAR.atlas.default`; brak klucza w `PLAYER.hullLootGear` = domyślny, `null` = puste). Część jak moduł: hangar `partStock` ↔ gniazdo, cena `fitPartPrice`; zapis `hullLootGear` w `serializePlayerFitState` / `restorePlayerFitState`; UI — sekcja ZBIÓRKA w refit ręcznym (`fittingPanel.js`), API `lootGear` / `setLootGear`.
- WIĄZKA (`stepTractor`): nowy cel to paczka w zasięgu kadłuba (Atlas 3,6 km, 4 naraz), widoczna (mgła — `SensorSystem.pointVisible`), z której wejdzie choć sztuka i która porusza się względem okrętu wolniej niż `maxRelSpeed` 400 j./s (paczki mają pęd wraku — gracz dopasowuje prędkość, nie staje; prędkość bezwzględna to tylko wyłącznik hipercruise'u i warpa: > `maxShipSpeed` 1200 j./s). Ciągnie ku punktowi chwytu z hamowaniem (v = √(2 a d), sufit 380 j./s — poniżej progu chwytu). BLOKADA (`LOCK`, `lockHold` 3 s od ostatniego kroku w wiązce): paczka trzymana ma pierwszeństwo przed nowymi celami (drugi wrak bliżej nie odbiera jej wiązce) i nie odpada przez prędkość względną, mgłę, brak miejsca ani chwilowe przekroczenie wyłącznika. W 240 j. — do ładowni; reszta, która nie weszła, czeka przy luku z prędkością okrętu (`HELD`, raz liczona: `stats.held`, `stats.full` → komunikat „ŁADOWNIA PEŁNA”) i wchodzi, gdy zwolni się miejsce. Punkt chwytu = środek statku.
- EKONOMIA: towar opuścił gospodarkę przy załadunku i siedzi w rekordzie wraku świata ruchu (`byPirates: false` — nie do kryjówki; złomiarze biorą tylko wraki wojny); wraca sprzedażą (`adjustStationStock`). Nic się nie dubluje; symulacja ruchu bez zmian. Zestrzelenie encji bez awansu zbija reputację jak NPC (`registerTrafficKill` → `registerFactionKill`, D13).

## Obraz (K2)

- GRA składa ramkę klatki (`lootRenderFrame` w `index.html` → `fillLootRenderFrame`): pozy w chwili klatki renderu (x − vx · (1 − alpha) · krok), tylko paczki widoczne (mgła wojny — `SensorSystem.pointVisible`) i poza kropkami soczewki skoku (`lensDotAt` przy `_lensDotsActive` — jak proxy statków ruchu), flagi wiązki i końcówki życia, poza renderu statku gracza (źródło wiązki). Render niczego o mgle i soczewce nie wie.
- SZEW: blok migawki `loot` (`src/render/blocks/lootBlock.js`, faza begin, `createLootFrame` — ten sam kształt ramki po obu stronach; `LOOT_RENDER_FLAG` = `LOOT_BLOCK.TRACTOR` / `FADE`, test). Tryb `off` — ta sama ramka do `sharedLootContainers3D().update` obok `sharedPortCargo3D` (sufit `index:aktualizacja` +1 z powodem).
- OBRAZ (`src/3d/cargo/lootContainers3D.js`, worker renderu po przeładunku E12): paczka = moduł kontenerów E12 wg masy (do 16 t — 1, do 64 t — 2 × 2, wyżej 2 × 2 × 2; farby rodziny z `containerLookLinear`, materiał `containers.tsl.js` w WARIANCIE ŁUPU `{ loot: true }` — poza ładownią słońce `LOOT_CARGO_LIGHT` 50° nad płaszczyzną i wypełnienie, bo słońce kontenerów E12 jest prawie poziome jak na kadłubach i wieka wychodziły ciemne; osobny graf budowany raz, kontenery E12 bez zmian — WGSL bit w bit, test), podstawa 2 j. nad płaszczyzną gry; lampka-boja HDR (`CargoLights`, bursztyn × 5 — bloom; błysk co 1,5 s, końcówka życia co 0,3 s); wiązka — strumień 14 świecących punktów płynących od paczki do statku. Dwa rysunki na wszystkie paczki (partie `CargoContainers` i `CargoLights`), względem początku przy kamerze (`sceneOriginNearCamera`, `mesh.position`). Światło kontenerów (`CARGO_LIGHT`, `CARGO_LIGHT_VIEW`) jest wspólne z przeładunkiem — oba moduły ustawiają te same wartości tej klatki.
- ROZGRZEWKA: wpisy `kontenery-łup` i `kontenery-łup (kamery 3D)` przy imporcie modułu (faza `'after'` — paczki pojawiają się dopiero po zestrzeleniu), rysunek dopiero po wpisie (`warm`).

## Zasady

- Nowa ścieżka zniszczenia statku ruchu z ładunkiem w grze → `spillTrafficCargo(manifest, kurs, poza, ruch, obrys, środek wybuchu)` (inaczej ładunek przepada bez śladu).
- Krok puli tylko w `physicsStep` (`stepLoot` po `stepTrafficRam` — pauza i sceny stoją); bez alokacji w kroku (cele wiązki w tablicach typowanych).
- Limit chwytu i przepełnienie liczą się z prawdziwego `cargoCap` kadłuba (`getPlayerCargoFree`). Atlas: 400 t (`ATLAS_CARGO_CAP`, D1 — decyzja użytkownika 2026-10-27); luk pokazuje wypełnienie masa / 400 t. Skutki dla handlu, kopalni i naprawy: `docs/PROPOZYCJA-kontenery-lup.md` § 6.

## Jak sprawdzać

- `node --test tests/lootRender.test.mjs` (ramka obrazu: poza, mgła, soczewka, wiązka; blok `loot` bit w bit; moduł 3D na atrapie Core3D — moduły wg masy, lampki, wiązka, początek przy kamerze, rozgrzewka; WGSL w Node). `node --expose-gc --test tests/lootContainers.test.mjs` (podział, determinizm, dryf, czas życia, pełna pula, wiązka, mgła, pełna ładownia, bez alokacji, gniazdo); `node --test tests/playerFitSave.test.mjs` (gniazdo ZBIÓRKA: zdjęcie, zakup, F5); `node --test tests/workerBubble.test.mjs` (manifesty: tylko zmiany, ładunek kursu).
- W grze: `node scripts/webgpu/kontenery-gra.mjs [--query renderWorker=0]` — zestrzelenie jednym strzałem (bez awansu), wiązka 24 s, puste gniazdo (podpowiedź), awansowany NPC; zrzuty (zbliżenie paczek `01b`, lampki `01c`, wiązka `02`) i `raport.json` w `.tmp/kontenery`, pipeline'y synchroniczne workera i strony (ma być 0). Konsola: `LootContainers` (`count`, `stats`, `gear`, `hold`, `devSpill({ steel: 380 })` z `?dev`), `PlayerFit.lootGear()` / `setLootGear(id | null)`.
