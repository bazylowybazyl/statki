---
paths:
  - "src/3d/stations3D.js"
  - "src/3d/world3d.js"
  - "src/vfx/shatterMaterial.js"
  - "src/vfx/destruction*.js"
---

# Stacje i obiekty świata 3D: rozpad stacji, rozgrzewka

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Pliki obszaru (z mapy repozytorium)

- **`src/3d/world3d.js`** — obiekty świata 3D (np. piracka stacja), podpinane do `Core3D.scene`.

- **`src/3d/stations3D.js`** — stacje 3D, podpinane do `Core3D.scene`.

## Stacje i obiekty 3D

- `updateStations3D(stations)` — synchronizacja stacji 2D -> 3D.

- Stacja gracza (`style: 'player'`, rynek dodany w biegu — reguła `ruch-v2`, § „Stacja gracza”) nie ma bryły: `isPlayerStation` pomija ją w `prepareStations3D`, `initStations3D` i `updateStations3D` (model dodany po ekranie ładowania kompiluje pipeline w klatce), w grze rysuje ją znacznik 2D. Model stacji gracza = szablon w rozgrzewce na ekranie ładowania i dopiero wtedy zdjęcie wyjątku.

- Zniszczenie stacji: `destroyStation3D` → `Destruction3D.shatter` (odłamki paneli + wygaszenie bryły), progi HP →
  `Destruction3D.detachChunk` (fragment leci, pęka na kawałki z maską cięcia, potem odłamki). Materiały rozpadu w TSL
  (`src/vfx/shatterMaterial.js`); nowa bryła stacji ma przejść przez `Destruction3D.prebake` (wypiek + rozgrzewka — bez niej
  pierwszy rozpad buduje materiały w swojej klatce). Szablon GLB nietknięty: wygaszenie i kawałki pracują na klonach.

- Rozgrzewka stacji (zadanie 25a): `prepareStations3D(stations)` na ekranie ładowania (`startGame`, przed pasem asteroid i `flush()`) — szablony
  GLB modeli używanych przez stacje (`MODEL_URLS`) wczytane, na warstwie FG jak klony, `Destruction3D.prebake(szablon)` (klony
  dzielą z szablonem geometrię i materiały — wypiek i klucze rozgrzewki są wspólne), pass FG i pass mapy cienia szablonu w
  rejestrze, potem bryły stacji (`initStations3D`); pierwsza stacja modelu w kadrze i jej rozpad nie kompilują nic. Nowy model
  stacji = wpis w `MODEL_URLS`, reszta sama. Tryb worker (render w workerze): strona NIE woła `prepareStations3D`
  (bryły stacji powstają w workerze leniwie, w `updateStations3D` przy wejściu w kadr) — worker przy przygotowaniu
  sceny po klatce zero (`prepareScene`, `afterFrame`) woła `warmStationTemplates3D(lustra stacji)`: szablony modeli
  używanych przez stacje wczytane (limit 8 s, pod kurtyną), wypiek rozpadu, pass FG i cień w rejestrze z fazą
  `'after'`, bez składania brył. Szablon wczytany po limicie (oba tryby) rozgrzewa się w wolnej chwili
  (`requestIdle`), nie w callbacku wczytania. Bez tego pierwsza stacja modelu w kadrze (teleport do odległego portu:
  Ceres — model Marsa, Merkury / Westa — model domyślny Ziemi) kompilowała pass FG i cień w klatce. Sprawdzenie:
  przegląd portów `node scripts/webgpu/ruch-banka-gra.mjs --obserwacja 8 [--query renderWorker=0]` — 0 pipeline'ów
  sync workera i strony. Stacja piracka (`world3d.js`): bryła budowana na ekranie ładowania (wygląd z
  własnego strumienia `FxRandom` o stałym ziarnie, stan wspólnego `fxRandom` wraca po wypieku — budowa nie przesuwa ani
  losowań gry, ani ciągu efektów), `attachPirateStation3D` bierze ją gotową; światła latarni to stałe światła sceny od
  startu gry (pułapka 34; zgaszone dokładają 2 światła punktowe do materiałów oświetlanych światłami sceny — PBR księżyców
  i stacji, bryły rakiet; skały pasa je pomijają).

- Materiały rozpadu w TSL (`src/vfx/`, zadanie 16): rozpad na trójkąty i implozja = dwa grafy w `shatterMaterial.js` (budowane
  raz, lekki `ShatterNodeMaterial` per mesh, wartości w `material.uniforms` przez `onObjectUpdate`, mapa per obiekt
  `teksturaObiektu`); wierzchołki w `vertexNode`, więc pass cienia rysuje nieprzesuniętą bryłę jak dawny `MeshDepthMaterial`.
  Kawałki skorupy po `detachChunk` tną się **maską TSL** (`maskNode` klonów, płaszczyzny per obiekt rzutowane do widoku — ta
  sama reguła co `material.clippingPlanes` w WebGL), nie `ClippingGroup` (pułapka 18). Klony materiałów GLB (wygaszenie bryły,
  kawałki) dostają węzły cienia oryginału (`_shareShadowNodes`). Geometria i materiały kawałka (`_cloneShellHierarchy`) to jego
  WŁASNE klony, bez flagi zasobu szablonu `__sharedTemplateAsset` — `DestructionDebrisManager` zwalnia je z odłamkami (szablonu
  GLB, wspólnego dla wszystkich stacji modelu, nie wolno). Rozgrzewka przy `Destruction3D.prebake` (wpisy rejestru
  `rozpad stacji: …`): trójkąty, implozja, wygaszenie, kawałki — trzymacze z układem geometrii bryły w passie sceny (wygaszenie
  i kawałki: jeden na podpis materiału — pola klucza materiału three, `_materialSignature`); pass cienia
  (siatki z `castShadow`) — `shadow: true` (w tle; trzymacze na warstwie 31 przez 2 klatki tylko jako zapas), także trójkąty
  w miejscu (pułapka 33); pule odłamków paneli — `PanelShardManager.prewarm`. Klatka rozpadu bez budowy materiałów
  (`scripts/webgpu/rozpad-stacji.mjs`). Odłamki paneli są CZARNE jak w WebGL (pułapka 22) — barwy z `instanceColor` to decyzja
  wyglądu (kolor pul 0xffffff). Harness: sesja „stacja” (warianty `__3d` / `__fg-3d` bez wybuchu reaktora); różnice na
  sylwetkach vs wnętrza: `scripts/webgpu/krawedzie.mjs`.

- `updateWorld3D(dt, t)` — aktualizacja obiektów świata 3D.

## Stacje w soczewce skoku gracza (etap 3A nowego warpa, 2026-10-26)

- Stacja przy planecie albo małym ciele (`station.planet.id` — w workerze opis lustra `planet: { id }`) jedzie w skoku za obrazem SWOJEGO ciała: kotwica soczewki `WARP_LENS_ANCHORS[id]` (`src/3d/warp/worldLens.js`, pisze `planet3d.assets.js`) → `lensAnchorPoint` (obraz = kotwica + k · odstęp od prawdziwego środka ciała), skala grupy × k (ta sama co tarcza ciała; stolica Unii przy Ceres ~14 px, reszta ~2 px), przy β → 0 prawdziwe miejsce. W soczewce (udział prawdziwego widoku < 0,999) stacja przechodzi z FG na warstwę passa TŁA (`STATION_LENS_LAYER` = 1, `Core3D.renderPassBg` — ta sama kamera perspektywy co FG, rysowany przed passem gry; wzór `HALO_GAME.lensLayers` ringu) z z jak poza soczewką (−100): zmienia się tylko kolejność — stacja pod kadłubami (pass FG rysuje się nad statkiem — reguła „nic z soczewki na statku”), rzut bez zmian (przejście perspektywa → ortho przestawiało wysokie części bryły o z · odstęp / camZ); pod tarczami planet (pass planet rysuje się po tle — stacja leży poza tarczą obrazu ciała). Po soczewce `Core3D.enableForeground3D` (także przy ponownym dodaniu grupy do sceny — `record.lensLayers = false`). Klucz pipeline'u three r183 nie zawiera kamery ani warstwy (stałe światła sceny są na wszystkich warstwach), więc przełączenie nie powinno budować pipeline'ów — DO POTWIERDZENIA pomiarem w grze (`warp-ped-gra`, start z doku Ceres, worker i off); włączone A/B świateł dysz tylko na warstwie 0 (`enginePointLights`) zmieniłoby zestaw świateł passa. Liczby rysunków bryły GLB w soczewce nie zmierzono (stolica Unii przy ~14 px — kilkanaście siatek?). Obraz mniejszy niż `STATION_LENS_MIN_PX` (3 px) — schowany. Stacja zgłasza zasięg w kotwicy (`reach`) — decyzja wejścia ciała w soczewkę widzi ją w kadrze (tryb ruchu, bez przeskoku). Nowa rzecz przypięta do ciała — przez kotwicę (opis w regule `warp`), nie przez własną kopię mapy.
