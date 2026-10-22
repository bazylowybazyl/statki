---
paths:
  - "src/3d/cargo/portCargo3D.js"
  - "src/3d/cargo/bayBatch.tsl.js"
  - "src/3d/cargo/conveyor.tsl.js"
  - "src/game/swarm/berthTransfer.js"
  - "src/game/portCargoFrame.js"
  - "src/render/blocks/cargoOpsBlock.js"
  - "scripts/webgpu/przeladunek-gra.mjs"
---

# Przeładunek w portach: ładownie, rój dronów, stoły i taśmociągi przy stanowiskach (E12)

> Reguła obszaru (E12, 2026-10-22). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/E12-przeladunek.md`.

## Stan

- Przy zadokowanym frachtowcu bańki ruchu (E6, zatoki Ziemi — grzebień S / M / L i pasy MEGA) ładownia otwiera się po klamrze, rój dronów (model, chwyty płaskie S 1 / M 2 / L 4 / C 8 i ramiona teleskopowe z dema `dema/roj-webgpu.html` — reguła `roj-przeladunkowy`) przenosi WARSTWY kontenerów między ładownią a stołami przy burcie, a taśmociąg wzdłuż placu wiezie je do portalu w grzbiecie zatoki (UNLOAD) albo z niego (LOAD). Luk Atlasa otwiera się przy postoju na polu stanowiska (`berth-hold`) albo przy otwartym terminalu stacji i pokazuje ładunek gracza (`PLAYER.cargo` — widok liczby: wypełnienie = masa / ładowność, wygląd z surowców wg udziałów masy; pole myśliwców i stanowisko fregaty zwiadu w luku zostają wolne — „okręty zabierają miejsce ładunkowi”).
- Hale K-7 przeładunku nie mają: dziś cumuje tam tylko garnizon (postój REFUEL) i zapas floty (STOCK).
- To WYŁĄCZNIE obraz: ładunek, tryb i czas postoju liczy świat ruchu (kontrakt `actors.cargo` z workera ruchu — E6), nic stąd nie wraca do gry ani ekonomii. `?przeladunek=0` — bez obrazu (A/B kosztu), `?przeladunekDemo=1` — przeładunek z ziarna kursu (dev, póki worker ruchu nie wystawia kontraktu).

## Przepływ

- GRA (`src/game/portCargoFrame.js`, blok „PRZEŁADUNEK W PORTACH” w `index.html`): ramka klatki = pola zatok w kadrze (+1800 j.), statki przy stanowiskach (fazy capture / docked / undock, kadłub z ładownią) z kontraktem przeładunku i zegarem postoju w chwili klatki (`DOCK_TIME` + czas od bufora), rekord gracza. Klasa pola z id stanowiska (`…-MG1`, `…-L01`…), wymiary i `yardHalfBeam` z `PORT_CARGO_PADS`. Nic się tu nie planuje.
- SZEW: blok migawki `cargoOps` (`src/render/blocks/cargoOpsBlock.js`, faza begin; kadłub = indeks `CARGO_BAY_HULL_ORDER`, surowiec = indeks `RESOURCE_KEYS`). Tryb `off` — ta sama ramka do `sharedPortCargo3D().update` na stronie przed `ShipProxyBatch3D.drawList`.
- OBRAZ (`src/3d/cargo/portCargo3D.js`, worker renderu — po luku Atlasa, przed proxy): plan na stanowisko w pamięci po numerze kursu (`planBerthTransfer`, najwyżej `plansPerFrame` nowych planów na klatkę — plan ciężkiego frachtowca ~3–5 ms), stan w chwili klatki (`berthTransferState`) → partie. Resolver dziur w lukach proxy (`ShipProxyBatch3D.setBayCutResolver`) podpina moduł sam.

## Plan przeładunku (`src/game/swarm/berthTransfer.js`)

- Plan to funkcja kontekstu (ziarno kursu, kadłub, tryb, wypełnienie, postój, geometria pola i poza statku względem pola), stan — funkcja planu i zegara postoju: statek zmaterializowany w połowie postoju ma od razu właściwy obraz. Nie wprowadzaj stanu przenoszonego między klatkami (zamki, liczniki) — zepsujesz materializację.
- Ruch jak w demie: parametry lotu klasy (`SWARM_DRONE_CLASSES.flight`, z ładunkiem × `SWARM_LOADED_SPEED` / `SWARM_LOADED_ACCEL`), profil trapezowy, czasy chwytu i odłożenia `SWARM_OP_TIMES`, rozkładanie ramion i zacisk szczęk wzorami kernela `swarmSim.js` (`eArm` / `gArm`), zegar roju = czas gry × 4 (`BERTH_TRANSFER_TUNE.clock`). Liczba dronów: gęstość jak w demie — co najmniej 1 dron na 8 warstw burty, więcej, gdy praca nie mieści się w ~62% okna, najwyżej `maxPerSide` (16); gdy okno jest za krótkie nawet wtedy — skala `speedScale` (rój szybciej niż ×4; dziś tylko ciężki frachtowiec LOAD: 1,06).
- Tory się nie krzyżują: drony jednej burty mają ciągłe przedziały slotów wzdłuż osi (granica tylko między slotami — piętra slotu bierze jeden dron, LIFO ładowni), burty rozdziela oś statku, sąsiednie drony w dwóch pasmach. Stół przyjmuje jedną warstwę naraz, komórka taśmy — jedną warstwę (test).
- INTERFEJS ŹRÓDŁA: obraz czyta przeładunek tylko przez `berthTransferState(plan, dockTime, sink)` (`door`, `drone`, `layer`, `belt`). Symulacja GPU z dema (ORCA, wieża) może zastąpić plan analityczny, jeśli da te same rekordy (decyzja orkiestratora 2026-10-22: plan analityczny tymczasowo — do decyzji użytkownika).
- Plac pola (`berthYardGeometry`): rząd stołów po każdej burcie za `yardHalfBeam`, taśma dalej od burty, portal przy dziobie (grzebień — lico grzbietu; MEGA — `portalGap` 150 j. do ściany tylnej), gniazda dronów — włazy w grzbiecie przy dziobie. Stół = obrys warstwy dla klasy pola (`BERTH_TABLE_FOOTPRINT`). Taśma pasa MEGA ×1,8 szybsza.

## Obraz i partie

- Jeden rysunek na rodzaj: ładownie floty (`CargoBayBatch` — wnętrze i skrzydła na kadłub, fragmenty wspólne z rigiem luku Atlasa: `bayInteriorFragment` / `bayLeafFragment` w `bay.tsl.js`), kontenery (`CargoContainers` — wszystkie: ładownie, chwyty, stoły, taśmy, luk gracza), drony (`SwarmDroneMeshes` z buforem storage `portCargoDrones` pisanym z CPU, regiony klas po `dronesPerClass`, zakresy wysyłki per klasa), światła dronów, taśmy / stoły / portale (`PortConveyors`). Nie twórz rigu (`CargoBayRig`) na statek ruchu.
- Precyzja: wszystko względem początku przy kamerze (`sceneOriginNearCamera`, `mesh.position` = początek), tablica ładowni (`CargoBayTable`: światło kontenerów i dronów) w tych samych współrzędnych. Rekord 0 należy do luku Atlasa (`scoutBay3D` pisze go w świecie) — przy ładunku gracza moduł nadpisuje TYLKO jego środek; rekordy 1–39 — statki ruchu tej klatki.
- Ładownia proxy leży na obrazku proxy: `TRAFFIC_CARGO_BAY_HULLS` (`cargoBays.js`) — sprite proxy `assets/X.png` ma układ płótna `assets/ships/X_empty.png`, długość rysunku = `renderLength` (test). Ciężki frachtowiec ruchu ma sprite dalekiego zasięgu w skali 1800 j. → `heavy_freighter_proxy`. Podmiana sprite'a proxy = zmiana mapy.
- Dziura w skórze proxy: prostokąt uv otworu w polach instancji `iAxisX.zw` / `iAxisY.zw` (`shipProxyBatch3D.tsl.js`) — tylko przy otwartych wrotach.
- Rozgrywka: import `portCargo3D.js` rejestruje wpis `przeładunek w portach…` w `Core3D.warmup` (faza `loading`, `WARIANT_INSTANCJI`) — nowy materiał obszaru dopisuj do `warmupMeshes()`.

## Jak sprawdzać

- `node --test tests/portCargo.test.mjs` (plan: pełna / pusta ładownia, zegar ×4 i prędkości klas, stół i komórka taśmy bez podwójnego zajęcia, LIFO, materializacja, plac, blok `cargoOps`, mapa kadłubów, WGSL partii w Node); `tests/cargoTsl.test.mjs` (rig luku po wydzieleniu fragmentów).
- W grze: `node scripts/webgpu/przeladunek-gra.mjs [--demo 1] [--flaga przeladunek=0] [--out .tmp/e12/…]` (tryb gracza — worker; świeżo zadokowany frachtowiec w zatoce, zbliżenia co kilka sekund postoju, kadr zatoki, luk Atlasa, koszt CPU / GPU workera, pipeline'y sync workera, błędy). A/B kosztu — dwa przebiegi PO KOLEI, ten sam build, drugi z `--flaga przeladunek=0`. Konsola: `PortCargo.frame` (ramka), `PortCargo.look(x, y, wysokośćKadru)` / `lookEnd()` i `devCargo({…})` (tylko `?dev`).
