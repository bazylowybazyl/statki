---
paths:
  - "src/3d/cargo/portCargo3D.js"
  - "src/3d/cargo/bayBatch.tsl.js"
  - "src/3d/cargo/conveyor.tsl.js"
  - "src/3d/swarm/swarmBerthPool.js"
  - "src/3d/swarm/swarmSlotFrame.js"
  - "src/game/swarm/berthTransfer.js"
  - "src/game/portCargoFrame.js"
  - "src/game/traffic/bubbleCargo.js"
  - "src/render/blocks/cargoOpsBlock.js"
  - "scripts/webgpu/przeladunek-gra.mjs"
---

# Przeładunek w portach: ładownie, rój dronów (symulacja GPU z dema), stoły i taśmociągi przy stanowiskach (E12)

> Reguła obszaru (E12, 2026-10-22). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/E12-przeladunek.md`.

## Stan

- Przy zadokowanym frachtowcu bańki ruchu (E6, zatoki Ziemi — grzebień S / M / L i pasy MEGA) ładownia otwiera się po klamrze, rój dronów Z DEMA (`dema/roj-webgpu.html`, reguła `roj-przeladunkowy`) liczony NA ŻYWO na GPU (decyzja użytkownika 2026-10-22: „spróbujmy na żywo liczone na GPU”) przenosi warstwy kontenerów między ładownią a stołami przy burcie, a taśmociąg wzdłuż placu wiezie je do portalu w grzbiecie zatoki (UNLOAD — po pracy roju) albo z niego (LOAD — przed startem roju). Luk Atlasa otwiera się przy postoju na polu stanowiska (`berth-hold`) albo przy otwartym terminalu stacji i pokazuje ładunek gracza (`PLAYER.cargo` — widok liczby; pole myśliwców i stanowisko fregaty zwiadu w luku zostają wolne — „okręty zabierają miejsce ładunkowi”).
- Hale K-7 przeładunku nie mają: dziś cumuje tam tylko garnizon (postój REFUEL) i zapas floty (STOCK).
- To WYŁĄCZNIE obraz: ładunek, tryb i czas postoju liczy świat ruchu (kontrakt `actors.cargo` — koder `src/game/traffic/bubbleCargo.js`, worker ruchu E6), nic stąd nie wraca do gry ani ekonomii. `?przeladunek=0` — bez obrazu (A/B kosztu), `?przeladunekDemo=1` — przeładunek z ziarna kursu (dev), `?przeladunekStres=N` — N syntetycznych przeładunków na polach w kadrze (pomiar).

## Przepływ

- GRA (`src/game/portCargoFrame.js`, blok „PRZEŁADUNEK W PORTACH” w `index.html`): ramka klatki = pola zatok w kadrze z zapasem (0,85 kadru + 1800 j. — więcej, niż obraz trzyma slot roju), statki przy stanowiskach (fazy capture / docked / undock, kadłub z ładownią) z kontraktem i zegarem postoju w chwili klatki, czas mostu (zegar roju), rekord gracza. Nic się tu nie planuje.
- SZEW: blok migawki `cargoOps` (`src/render/blocks/cargoOpsBlock.js`, faza begin). Tryb `off` — ta sama ramka do `sharedPortCargo3D().update` na stronie przed `ShipProxyBatch3D.drawList`.
- OBRAZ (`src/3d/cargo/portCargo3D.js`, worker renderu — po luku Atlasa, przed proxy): czasy postoju (`berthTransferTiming`), sloty roju dla N stanowisk najbliżej środka kadru (`SWARM_POOL_TUNE.slots`, najwyżej `activatePerFrame` dołączeń na klatkę — dołączenie ciężkiego frachtowca ~3–5 ms CPU), ładownie w stanie z zegara dla pozostałych (bez dronów), partie. Slot trzyma przeładunek, dopóki ten jest w ramce; przy pełnej puli stanowisko poza kadrem ustępuje stanowisku w kadrze.

## Pula roju (`src/3d/swarm/swarmBerthPool.js`)

- JEDNA symulacja (`SwarmSim` z dema: kernele, ORCA, zamki kolumn, kontenery) dla wszystkich stanowisk na żywo. Slot = stałe zakresy dronów, zadań, kontenerów, kolumn i wierszy mapy przeszkód oraz własny prostokąt przestrzeni symulacji (oś statku wzdłuż x — bez obrotu, float32 bez drżenia; sloty daleko od siebie, ORCA ich nie łączy). Dołączenie i zwolnienie = wpisy ZAKRESAMI (`addUpdateRange`) — nigdy pełna wysyłka po `ensure()` (nadpisałaby stan z GPU: pułapka `updateRanges` z reguły `roj-przeladunkowy`).
- Wieża portu (`createSwarmPlanner`) na slot: stan swoich dronów z odczytu GPU (`SwarmReadback`, MAP_READ asynchronicznie — bez czekania w klatce), zadania przez adapter (indeksy dronów, kolumn i kontenerów slotu → globalne).
- Krok compute: `Core3D.addFxStep` (raz na klatkę przed passami) — kroki za czas gry tej klatki × 4 (`pendingDt` z `update`), pauza = 0; `warm` — kernele z zerową liczbą dronów (pipeline compute three r183 powstaje synchronicznie przy pierwszym dispatchu).
- Obraz: materiały roju z ramą slotów (`swarmSlotFrame.js` — wiersz (tx, ty, φ) na slot: przestrzeń slotu → świat względem początku przy kamerze) w dronach, światłach i kontenerach; drony klasy przez mapę indeksów (`swarmDroneRemap` — klasy różnych slotów nie leżą ciągiem), światła wszystkich dronów jednym rysunkiem. Demo materiałów bez ramy nie zmienia.
- Stan startowy z zegara: warstwy przeniesione = postęp postoju (`progress`), UNLOAD — na stołach, LOAD — w ładowni; drony startują z gniazd (pierwsze sekundy statku zastanego w połowie postoju to start roju). Drony: gęstość jak w demie (dron na `layersPerDrone` warstw) albo tyle, żeby reszta zdążyła w oknie (`swarmSecPerLayer`). Koniec okna (`doorClose`) przed końcem pracy → `snap`: czekające i niesione kontenery znikają (przeładowane, gdy wrota się zamykały), drony slotu chowają się — ładownia przy odlocie jest taka, jak mówi ekonomia. Slot bez stanu czeka `missingGrace` s czasu gry (ramka bez przeładunku), dopiero potem dokańcza taśmę i się zwalnia.
- Stoły przeładunkowe stoją na wspornikach TUŻ POD płaszczyzną statku (`BERTH_TRANSFER_TUNE.tableZ`, kamera ortograficzna — wysokości nie widać), taśma na płycie pola: plac na płycie (115 j. niżej) dawał 4 długie odcinki pionowe na kurs i rój ~3,7× wolniejszy (ciężki frachtowiec nie mieścił się w postoju). Stoły = kolumny placu roju: odstęp i liczba z `berthYardGeometry` (te same, które rysuje `pushYard`).

## Plan analityczny (`src/game/swarm/berthTransfer.js`)

- Zostaje jako zapas i do testów (`planBerthTransfer`, `berthTransferState` — tory z ziarna i zegara, bez symulacji); gra używa z niego geometrii placu (`berthYardGeometry`) i czasów postoju (`berthTransferTiming`, `berthDoorAt`).

## Obraz i partie

- Jeden rysunek na rodzaj: ładownie floty (`CargoBayBatch` — wnętrze i skrzydła na kadłub, fragmenty wspólne z rigiem luku Atlasa), kontenery stanu z zegara i luku gracza (`CargoContainers`), rój (drony na klasę i LOD, światła, kontenery symulacji), taśmy / stoły / portale (`PortConveyors`). Nie twórz rigu (`CargoBayRig`) na statek ruchu.
- Tablica ładowni (`CargoBayTable`, światło kontenerów i dronów): rekord 0 — luk Atlasa (`scoutBay3D`; moduł nadpisuje tylko jego środek względem początku), 1…N — sloty puli (STAŁE: kontenery symulacji niosą indeks w buforze GPU), dalej — stanowiska z zegara tej klatki.
- Ładownia proxy leży na obrazku proxy: `TRAFFIC_CARGO_BAY_HULLS` (`cargoBays.js`; test). Ciężki frachtowiec ruchu → `heavy_freighter_proxy`. Dziura w skórze proxy: pola instancji `iAxisX.zw` / `iAxisY.zw` (`shipProxyBatch3D.tsl.js`).
- Import `portCargo3D.js` rejestruje wpis w `Core3D.warmup` (faza `loading`, `WARIANT_INSTANCJI`) — nowy materiał obszaru dopisuj do `warmupMeshes()`.

## Jak sprawdzać

- `node --test tests/portCargo.test.mjs` (pula: stan z zegara, krok w Core3D.fx, zwolnienie; WGSL z ramą slotów; kontrakt E6; blok; mapa kadłubów; plan analityczny).
- W grze: `node scripts/webgpu/przeladunek-gra.mjs [--demo 1] [--kadlub container_ship|heavy_freighter] [--diag 1] [--tylkoKoszt 1 --flaga przeladunekStres=20|przeladunek=0]` (tryb gracza — worker). `--diag 1` czyta statystyki obrazu i puli W SESJI WORKERA (CDP): sloty, dołączenia / zwolnienia z powodem, postęp wieży. Wyjątek w `update` ląduje w `stats.err` — raport workera do strony bywa wyczerpany (limit 20 błędów na sesję) i nie dociera do harnessu.
