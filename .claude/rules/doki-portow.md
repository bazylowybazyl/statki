---
paths:
  - "src/data/portDocks.js"
  - "src/3d/portDocks/**"
  - "src/3d/portDocks3D.js"
  - "src/3d/portBuildings/portDock*.js"
  - "src/game/portDockWorld.js"
  - "src/render/blocks/portDockBlock.js"
  - "tests/portDocks.test.mjs"
  - "tests/portDockBlock.test.mjs"
---

# Doki portów bez ringu (E14): krzyż, okrąg, koło z wlotem

> Reguła obszaru (E14, 2026-10-23). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Bańka ruchu i ekonomia: reguła `ruch-v2`. Decyzje, przydział i pomiary: `docs/E14-doki-portow.md`.

## Stan

- Port BEZ ringu (planety bez „Halo”, księżyce, Ceres, Westa, kryjówki Gniazdo Hildy i Złomowisko, stacja gracza) ma JEDNĄ budowlę doku w jednym z trzech rodzajów (decyzja użytkownika 2026-10-22): `cross` — cztery ramiona, grzebienie stanowisk po obu stronach, capital / MEGA na czubkach ramion; `round` — obręcz ze stanowiskami na obwodzie, wejście promieniowe; `wheel` — płaski Coriolis: szczelina w obręczy, stanowiska na wewnętrznej ścianie, w środku obraca się tylko piasta (obraz). Porty z ringiem (Ziemia, Mars, Jowisz) zostają przy halach K-7 i zatokach; hangary kryjówek misji (układ `hangar`: baza piratów na planetoidzie, kryjówka najemnika, stocznia piratów) — bez budowli (scena misji ma własne pomosty, budowla obok weszłaby w planetoidę), stanowiska jak dawniej w pustej przestrzeni.
- PRZYDZIAŁ po wielkości portu (`portDockKindFor` w `src/data/portDocks.js`; mnożnik stanowisk z przeładunku): 1 komplet (≤ 26 stanowisk) — krzyż, 2–3 — okrąg, ≥ 4 — koło. Nadpisanie: `docks.kind` w definicji rynku. Styl budowli z frakcji właściciela (`PORT_DOCK_STYLE_BY_FACTION` → rodziny hal K-7: earth, mars, jupiter, pirate).
- JEDNO ŹRÓDŁO GEOMETRII: `src/3d/portDocks/portDockLayout.js` (`buildPortDockGeometry({ kind, mix, repeats, dockCount })`, czysta matematyka, pamięć po kluczu) — stanowiska, ścieżki wejścia i wyjścia ([u, v, rola] — `DOCK_PATH_ROLE`), lejki, wielokąty brył (`solids`), dysk zapasu `keepR`, wymiary modelu. Liczą z niej worker ruchu (`dockLayout.js` → `portPaths.js`), gra (`src/game/portDockWorld.js`) i obraz. Układ lokalny = gra obrócona o kąt budowli, oś +u patrzy na węzeł portu.
- GOSPODARKA BEZ ZMIAN: `buildStationDocks(stacja, { model })` stawia stanowiska na budowli, ale id (`<port>:dok<k>:b<i>`), klasy, kolejność, role, doki z `ringAngle`, `dockRadius`, `parkingRadius` i `parkingSlots` są jak przy pomostach — rekordy kursów, dyspozytor, punkty manewrowe (`approachPoint` z `parkingRadius`) i kolejka liczą to samo. Budowla stoi `nodeClearance` (7,6 tys. j.) + `keepR` od węzła w kierunku: planeta / kryjówka / stacja gracza — ku Słońcu, księżyc — od planety-rodzica, stacja małego ciała — od ciała. Klasy stanowisk i składy (`BERTH_CLASSES`, `BERTH_MIXES`) są w `src/data/portDocks.js` (re-eksport z `dockLayout.js`).
- BAŃKA (`materializedFlight.js`): wpis stanowiska `kind: 'model'` (`portPaths.js`, `buildModelEntry`) — gotowe ścieżki, lejek za dyskiem zapasu (trasa z przestrzeni kończy się w lejku, dalej osią podejścia do punktu czekania), wyjście za dysk. Trasy objeżdżają dyski budowli (`routeAround`: styczna → łuk → styczna, łuk 1,6 tys. j. za dyskiem — swobodny lot ścina zakręty o ≤ 1,5 tys.), punkty dyspozytora w dysku wypycha `resolveCore`. Korytarze: krzyż — grzebień (strona ramienia) jak bank K-7, czubek i okrąg — na stanowisko; koło — wlot połowy (`in1` / `in2`) i osobny wylot połowy (`out1` / `out2`, `entry.corridorOut`). W korytarzach budowli „gęsiego” po kierunku jazdy, wychodzący ustępuje wchodzącym, przy wzajemnym — niższy numer kursu (bez zakleszczeń). Wycofany statek obraca się dopiero tam, gdzie koło obrotu nie zahacza sąsiadów (`roundBack`, `wheelBack`).
- KOLIZJE GRY (`PortDockWorld`, blok „DOKI PORTÓW BEZ RINGU” w `index.html`): tabela `TrafficV2.tables.bubbleDocks` (worker: `ready` / `tick` po zmianie rynków, `docksVersion`) → bryły w układzie gry. `stepShipDockCollisions` po kolizjach ringu: gracz, drugi gracz, NPC (w tym awansowane z bańki) — SAT z obwiednią `haloShipOutline`, prędkość w głąb zerowana; głęboko w budowli (teleport) — wyjście promieniowe. Hipercruise nie przelatuje brył (`blockTunnel` — powrót do pozy sprzed kroku, zerwanie). Pociski gasną w bryłach (`pointInSolid`). Autopilot (`planCruiseRoute`) objeżdża dysk budowli, chyba że start albo cel w nim. `DevScene.teleport` wypycha kadłub z bryły.
- OBRAZ: budowla = `PortDock3D` (`src/3d/portBuildings/portDock3D.js`, `extends PortBuilding3D` — zestaw budowli Z7: instancje prostopadłościanów, walców i torusów w zestawach BG 1 / FG 2, grafy TSL raz na tryb światła, światło „przestrzeń”: słońce gry + `sunVisibility`), scena z geometrii doku (`buildPortDockScene` w `portDockScene.js`; układ budowli x = −v, z = u; korpus z tych samych wielokątów co kolizje). Przy każdym stanowisku rękaw, kleszcze, lampa i znacznik pola; koło — światła pasów szczeliny (wloty zielone do środka, wyloty bursztynowe na zewnątrz) i pierścieni A / B, piasta = grupa ruchoma (pełny obrót 240 s). Bez napisów (atlas = tekstura na budowlę). Klej `src/3d/portDocks3D.js`: `updatePortDocks3D(lista, n, dt, słońce = RenderWorld.sun)` — pula budowli (najwyżej 1 nowa na klatkę, ponowne użycie po kształcie i stylu, do 6 w pamięci), duży offset tylko w ramce korzenia (`portModuleFrame(x, −y, −kąt)`, wyznacznik +1). Rozgrzewka: wpis `doki portów: krzyż, okrąg, koło` (faza `loading`, szablon na rodzaj — te same grafy i układ atrybutów co każda budowla). Dane: gra `portDockRenderFrame(cam)` (budowle w 90 tys. j. od kamery, `PortDockWorld.renderList`) → blok migawki `portDocks` (8 budowli × 8 liczb: rodzaj, skład, styl, komplety, doki, x, y, kąt; `src/render/blocks/portDockBlock.js`) → worker renderu; w trybie `off` `updatePortDocks3D` obok `ShipProxyBatch3D.drawList`. `?szew=inline` doków nie rysuje (jak proxy E6).

## Zasady

- Zmiana geometrii (wymiary, ścieżki) = test `tests/portDocks.test.mjs` (pola ∩ bryły, ścieżki ∩ bryły i cudze pola, lejki i wyjścia za dyskiem) i sekcja „Budowle doków” w `scripts/tests/portPaths.test.mjs` (dokowanie z krokiem 0,2 s, kadłub poza bryłami i zacumowanymi statkami, odlot za dysk). Bryła w obrazie MUSI się pokrywać z `solids` (rozgrywka 2D jest źródłem prawdy).
- Nie ruszaj id, klas, kolejności ani promieni redy w `buildStationDocks` — to wejście gospodarki; sprawdzenie: `SEED=7 node scripts/symulacja-ruchu.mjs 240 1 4 60` liczba w liczbę z bazą.
- Nowy ruch statku przy porcie bez ringu (spawn, teleport, autopilot, skok) omija bryły doku: `PortDocks.constrainShip` / `freeSpot` / `pushCruiseObstacles` (hak w `AGENTS.md`).
- Statki bańki nie mają kolizji z bryłami w grze — omijają je ścieżkami; nowa ścieżka bańki przy budowli przechodzi przez `routeAround`.

## Jak sprawdzać

- `node --test tests/portDocks.test.mjs`, `node scripts/tests/portPaths.test.mjs` (sekcja budowli), `node --test tests/workerBubble.test.mjs` (porty bez ringu).
- W grze: konsola `PortDocks.docks` (budowle, bryły), `TrafficV2.tables.bubbleDocks`; przegląd portów `node scripts/webgpu/ruch-banka-gra.mjs --obserwacja 8 [--query renderWorker=1]`.
