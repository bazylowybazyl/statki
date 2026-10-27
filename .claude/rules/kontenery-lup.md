---
paths:
  - "src/game/lootContainers.js"
  - "src/data/lootGear.js"
  - "tests/lootContainers.test.mjs"
  - "scripts/webgpu/kontenery-gra.mjs"
---

# Kontenery-łup: ładunek zniszczonych statków ruchu, gniazdo ZBIÓRKA (wiązka, drony)

> Reguła obszaru (K1, 2026-10-27). Zasady przekrojowe i indeks reguł: `AGENTS.md`. Propozycja, warianty, plan K1–K5 i decyzje D1–D17: `docs/PROPOZYCJA-kontenery-lup.md`. Manifest encji w protokole bańki — reguła `ruch-banka`; wyposażenie gracza — `statek-gracza`.

## Stan

- Zniszczony statek ruchu gubi 55% ładunku (`LOOT_TUNE.survive` = `PIRACY_MODEL.lootRecovery` — jedna stała dla gracza i piratów AI) jako paczki dryfujące w przestrzeni; gracz zbiera je sprzętem z gniazda ZBIÓRKA do ładowni (`addToPlayerCargo`, limit `cargoCap`), sprzedaje w terminalu. Rozgrywka w 2D (`src/game/lootContainers.js`, czysta); obraz K1 to podgląd na kanwie 2D (`drawLootContainers2D` w `index.html` — farba rodziny `containerLook`, lampka, linia wiązki); 3D z bloku migawki — K2.
- ŹRÓDŁO ŁADUNKU: manifest encji z workera ruchu (`actors.manifests` / `unmanifested`, most `TrafficV2.actorManifests` — tylko zmiany), bo rekord wraku (`tick.wrecks`) przychodzi dopiero po kroku świata (do 5 s). Manifest mają tylko kursy w locie z ładunkiem (bez promów z ludźmi, pustych przelotów i wyprawy górniczej przed urobkiem). Awansowany NPC niesie kopię (`npc.__trafficCargo`), bo po `attach` worker zdejmuje manifest.
- KIEDY (D3): tylko przy zniszczeniu — encja bańki bez awansu (`onTrafficActorDestroyed`, wybuch w miejscu trafienia) i awansowany NPC (werdykt `dead` w `stepTrafficPromotion`). Wysyp przy wyrwie w ładowni żywego statku — K4.
- PODZIAŁ (`planLootSpill`): przetrwa `survive` każdej pozycji, całe sztuki; paczek wg klasy ładowni z masy (`vanClassForMass` → `piecesByClass` 2 / 4 / 6 / 10 / 16), proporcjonalnie do masy towarów (każdy co najmniej jedna), ostatnia bierze resztę. Rozrzut deterministyczny z numeru kursu (`cargoHash01`), bez `Math.random`: miejsce w obrysie, pęd wraku + 40–140 j./s od środka wybuchu, obrót w płaszczyźnie.
- RUCH: dryf bez tarcia, po 20 s tłumienie do 15 j./s; życie ~5 min (`ttl` ± 10%), dalej niż 50 km od gracza — przepada. Pula 256 (SoA, x / y `Float64Array`, usuwanie zamianą z ostatnią); pełna → doklejenie do najbliższej paczki tego towaru, bez takiej — zastąpienie najkrótszego życia. Kontenery to duchy (D11): bez zderzeń i trafień.
- GNIAZDO ZBIÓRKA (`src/data/lootGear.js`; decyzja użytkownika 2026-10-27: „wiązka lub drony”): jeden wybór na kadłub (D14) — pusto, wiązka (`loot_tractor`) albo drony (`loot_drones`, `ready: false` do K3). Bez sprzętu nic się nie zbiera (D15) — HUD podpowiada WYPOSAŻENIE, gdy widoczna paczka jest bliżej niż 4 km. Atlas ma wiązkę fabrycznie (D16: `HULL_LOOT_GEAR.atlas.default`; brak klucza w `PLAYER.hullLootGear` = domyślny, `null` = puste). Część jak moduł: hangar `partStock` ↔ gniazdo, cena `fitPartPrice`; zapis `hullLootGear` w `serializePlayerFitState` / `restorePlayerFitState`; UI — sekcja ZBIÓRKA w refit ręcznym (`fittingPanel.js`), API `lootGear` / `setLootGear`.
- WIĄZKA (`stepTractor`): łapie paczki, które poruszają się względem okrętu wolniej niż `maxRelSpeed` 400 j./s (paczki mają pęd wraku — gracz dopasowuje prędkość, nie staje; prędkość bezwzględna liczy się tylko jako wyłącznik hipercruise'u i warpa: > `maxShipSpeed` 1200 j./s); najbliższe widoczne (mgła — `SensorSystem.pointVisible`) w zasięgu kadłuba (Atlas 3,6 km, 4 naraz), z których wejdzie choć sztuka. Ciągnie ku punktowi chwytu z hamowaniem (v = √(2 a d), sufit 520 j./s względem statku); paczka trzymana w poprzednim kroku (`LOCK`) zostaje w wiązce mimo prędkości względnej — wiązka sama ją rozpędza. W 240 j. — do ładowni; reszta, która nie weszła, wisi przy luku (`HELD`, komunikat „ŁADOWNIA PEŁNA”). Punkt chwytu = środek statku (luk — K2).
- EKONOMIA: towar opuścił gospodarkę przy załadunku i siedzi w rekordzie wraku świata ruchu (`byPirates: false` — nie do kryjówki; złomiarze biorą tylko wraki wojny); wraca sprzedażą (`adjustStationStock`). Nic się nie dubluje; symulacja ruchu bez zmian. Zestrzelenie encji bez awansu zbija reputację jak NPC (`registerTrafficKill` → `registerFactionKill`, D13).

## Zasady

- Nowa ścieżka zniszczenia statku ruchu z ładunkiem w grze → `spillTrafficCargo(manifest, kurs, poza, ruch, obrys, środek wybuchu)` (inaczej ładunek przepada bez śladu).
- Krok puli tylko w `physicsStep` (`stepLoot` po `stepTrafficRam` — pauza i sceny stoją); bez alokacji w kroku (cele wiązki w tablicach typowanych).
- Limit chwytu i przepełnienie liczą się z prawdziwego `cargoCap` kadłuba (`getPlayerCargoFree`). Atlas: 400 t (`ATLAS_CARGO_CAP`, D1 — decyzja użytkownika 2026-10-27); luk pokazuje wypełnienie masa / 400 t. Skutki dla handlu, kopalni i naprawy: `docs/PROPOZYCJA-kontenery-lup.md` § 6.

## Jak sprawdzać

- `node --expose-gc --test tests/lootContainers.test.mjs` (podział, determinizm, dryf, czas życia, pełna pula, wiązka, mgła, pełna ładownia, bez alokacji, gniazdo); `node --test tests/playerFitSave.test.mjs` (gniazdo ZBIÓRKA: zdjęcie, zakup, F5); `node --test tests/workerBubble.test.mjs` (manifesty: tylko zmiany, ładunek kursu).
- W grze: `node scripts/webgpu/kontenery-gra.mjs [--query renderWorker=0]` — zestrzelenie jednym strzałem (bez awansu), wiązka 24 s, puste gniazdo (podpowiedź), awansowany NPC; zrzuty i `raport.json` w `.tmp/kontenery`. Konsola: `LootContainers` (`count`, `stats`, `gear`, `hold`, `devSpill({ steel: 380 })` z `?dev`), `PlayerFit.lootGear()` / `setLootGear(id | null)`.
