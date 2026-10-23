---
paths:
  - "src/3d/haloRing/**"
  - "src/game/haloRingWorld.js"
  - "src/game/haloRingCollision.js"
  - "src/game/k7GateLintels.js"
  - "dema/halo_ring_demo.html"
  - "scripts/halo-ring-shots.mjs"
---

# Ring „Halo” (Ziemia, Mars, Jowisz): świat ringów, kolizje, render

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Pliki obszaru (z mapy repozytorium)

- **`src/3d/haloRing/`** — ring „Halo” Ziemi i Marsa (teren, miasta, megastruktura, port K-7 — światła i soczewki hali: `haloPortK7Lights.js`, obsługa paliwowa stanowisk: ramiona SCARA i przewody z fizyką liny `haloPortK7Fuel.js`, rurociągi i zbiorniki paliwa; suwnic nie ma); obraz ringów `haloRingGame.js`, rozgrywka ringów (kolidery, teren, automat stanowisk K-7, lampki, zegar migania, poziom lamp hal) `src/game/haloRingWorld.js` (RW-27), kolizje `src/game/haloRingCollision.js`. Opis: `docs/PORT-halo-ring.md`, § „Obsługa paliwowa stanowisk K-7” niżej; demo samego doku `dema/dok-k7-webgpu.html`.

## Ring „Halo” (Ziemia, Mars, Jowisz)

- ŚWIAT RINGÓW GRY (RW-27, `src/game/haloRingWorld.js`, `haloWorld` w `index.html`, `window.__haloWorld`): `entries` `{ key, planet, collider, place, service }`, kolizje (`constrainShip`, `pointInSlab`), teren Marsa i Jowisza od razu z planów CPU (`ecumenePlan.js` / `fablePlan.js`), Ziemi z mapy CPU ringu obrazu po zbudowaniu (`setRingTerrain`), automat obsługi stanowisk K-7 w czasie gry dla KAŻDEGO ringu (bez bramki widoczności — także w podzielonym ekranie), zajętość i lampki stanowisk w rejestrze (`registry.halls[i].layout.berths[].occupied / reserved` + `berthVersion`; fabuła — `deps.k7SetBerth`, automat — `syncK7BerthLamps`), zegar migania `clock` i poziom lamp hal `owner.lampLevel` (cień planety ze słońca gry — ten sam wzór co obraz, test) — `frame({ nowMs, gameDt, ship, sun })` w `render()` przed obrazem ringów i wejściem pyłu hal. Gra (kolizje, radar, pył hal, przeszkody gazu, nadproża) czyta `haloWorld.entries`, nie wpisy obrazu.

- `HaloRingGame` (`src/3d/haloRing/haloRingGame.js`, obraz — `new HaloRingGame({ world })`; wpisy obrazu niosą odwołania do wpisów świata): BG warstwa 1, górna ściana, ramiona i przewody paliwowe K-7 w FG (warstwa 2). Bryły hali NAD płaszczyzną lotu tam, gdzie lata okręt, idą do zestawu `fg` (`haloPortK7Build.js`) — nadproża bram od 2026-10-13 (w `bg` belka rysowała się pod kadłubem; strażnik w `tests/haloPortK7.test.mjs`). Kanwa 2D i światła FG nie znają głębi: lampy pozycyjne (`setPositionLightOcclusion`) i okna mostków (`Bridge3D.emitterOcclusion`) pod nadprożem gasną (wieże 3D przykrywa nadproże — pass FG po ortho) — obrysy `k7GateLintelList` → `src/game/k7GateLintels.js` (odświeżane w `render()`); nowa bryła FG nad korytarzem lotu — ten sam test. `haloRings.update(frameDt, cam, …)` co klatkę PRZED `Core3D.render`, z kamerą TEJ klatki (`cam` ze wstrząsem) — ring liczy pozycje względem kamery (RTE), inna kamera przesunie go względem statków. Jakość = `OPTIONS.planetQuality` („Ultra” = dalszy LOD, `HALO_LOD_ULTRA`).

- RING W SOCZEWCE SKOKU (2026-10-19, demo `warp-ped`; user: „a co z resztą świata? ringi” → wybór „ring w soczewce z planetą”): w skoku gracza planeta z ringiem stoi w kadrze skoku (soczewka świata, reguła `warp`), a jej prawdziwy ring setki tys. j. dalej — ring jedzie z planetą. `planet3d.assets.js` (`_lensPlace`) publikuje dla planety z ringiem slot `warpRingLensSlot(klucz)` w `WARP_RING_LENS` (`src/3d/warp/worldLens.js`): środek obrazu planety (`x`, `y` w świecie), skala obrazu do prawdziwej (`k` = rozmiar tarczy w soczewce / promień), obrót przelotu bryły (`q`, `turned`), udział prawdziwego widoku (`real`), obraz w kadrze (`vis`); poza soczewką `on = false`. `HaloRingGame.update` stawia grupę ringu w obrazie (pozycja, `scale` k, kwaternion `q × rotZ(place.rot)`), zasięg widoczności × k, budowa ringu także, gdy jego obraz jest w kadrze (`lens.vis`); LOD i odcinanie części ring liczy sam z `group.matrixWorld`, więc przesunięta i przeskalowana grupa działa bez zmian w ringu. Cień ringu w masce słońca (analityczny okrąg na prawdziwym miejscu) × `real` (`Core3D.setShaftRingOccluder(…, siła)`) — gaśnie w soczewce jak tarcza planety. Kolizje, port i ruch zostają na prawdziwym miejscu (soczewka to obraz). W SOCZEWCE RING JEST TŁEM jak jego planeta (2026-10-23, zgłoszenie „planeta przebija się przez statek” — A/B odczytem pikseli: górna ściana i moduły ringu Marsa w passie FG, rysowanym PO kadłubach): `HaloRingGame` przekłada części FG ringu i hal na warstwę tła (`HALO_GAME.lensLayers`, `ring.setLayers` przy zmianie `lens.on`, ta sama kamera perspektywy — bez nowych pipeline'ów), po soczewce wraca do `HALO_GAME.layers`. Ring w soczewce rysuje się dopiero od `HALO_GAME.lensMinPx` (30 px promienia w buforze): mijana planeta jest w kadrze od początku skoku (przelot z daleka, reguła `warp`), a ring kosztuje ~3 ms CPU aktualizacji i ~50 rysunków także jako kreska wokół kilkupikselowej tarczy. Obrót kadru: kamera ringu z `up` = (sin roll, cos roll, 0) (`_syncCamera(…, roll)`), pudło kadru `rolledHalfExtents` (`src/3d/viewRoll.js`); bez obrotu i poza soczewką — bit w bit jak dawniej. Testy: `tests/warpWorldLens.test.mjs` (wpięcie), `tests/shadowShaftsQuality.test.mjs`, `tests/sunShadowMaskTSL.test.mjs` (siła okluderu).

- Ring jest PRZESZKODĄ w płaszczyźnie gry: płyta podłogi z terenem, przelot tylko 4 tranzytami (`stepShipRingCollisions`, `haloRings.pointInSlab` dla pocisków). Nowe ruchy statków przy Ziemi/Marsie/Jowiszu (spawny, teleporty, autopiloty) muszą tę płytę omijać.

- Płyta a szybki lot (E9, 2026-10-22): test podłogi jest DYSKRETNY (wierzchołki obrysu w pozie końca kroku, strona płyty ze środka statku), a płyta Ziemi ma 452 j. — mały kadłub przy 30–40 tys. j/s przeskakiwał połowę płyty (25–42% przelotów czołowych). Dlatego: hipercruise gracza wychodzi, zanim płyta wejdzie w drogę hamowania (`haloWorld.rayToSlab(x, y, kierunek, zasięg, pół kadłuba)` — odległość wzdłuż kursu do płyty poszerzonej o pół kadłuba, tranzyty przepuszcza; decyzja w `hypercruiseObstacleAction`), w hipercruise'ie działa test odcinka środka z pozy poprzedniego kroku (`haloWorld.blockTunnel` — przejście przez połowę płyty poza tranzytem cofa statek), a uderzenie przycina prędkość do `HYPERCRUISE_TUNE.exitSpeed`. Nowy szybki ruch przy ringu (> ~250 j. na krok) — te same dwa narzędzia. Pomiar: `node scripts/hipercruise-kolizje-sym.mjs --tryb ring`, w grze `scripts/webgpu/hipercruise-gra.mjs --etapy ring`; testy `tests/hipercruisePrzeszkody.test.mjs`; liczby — `docs/AUDYT-hipercruise-kolizje.md`.

- Stacja Ziemi, Marsa i Jowisza = stacja-port w hali K-7 (`ringPort`, `isCollidable: false`, `terminalRange`) — wyglądem stacji jest ring: nie rysuj dla niej brył ani ikon stacji.

- Doki portu (hale K-7, zatoki) stoją `HALO_PORT.dockGap` (2 500 j.) za krawędzią ścian ringu na dwóch pylonach od płyty portu na podłodze (poprawka użytkownika 2026-10-05: „za mocno wciśnięte w ring”) — położenie daje JEDNA ramka `k7Frame` (`frame.floorZ` < 0 w hubie, `frame.standoff` = długość pylonów; zatoka: `baseZ` = płaszczyzna tylna, nie podłoga). Pylony wystają wprost ze ściany tylnej doku, na jego wysokości, i są PRZESZKODĄ lotu — geometria tylko z `k7DockArms` (`k7HallArms` / `bayArms`: te same wielokąty dla brył i kolizji). Nie przypinaj doków z powrotem do podłogi ani nie chowaj pylonów pod dok; budowle Z7 poza grą — `k7FloorFrame`. Opis: `docs/PORT-halo-ring.md` § „Odsunięcie doków”.

- Trzy RÓŻNE ringi (decyzja użytkownika 2026-09-27): Ziemia = silnik Halo (`createHaloRing`), Mars = ECUMENE, Jowisz = ring Fable — z dem `orbital_ring_demo(_2).html` w skali ×3 (`createArchRing`, `src/3d/haloRing/arch/`). Archetyp i geometria są w profilu (`haloRingProfiles.js`), a `createHaloRingLayout` rozdaje je kolizjom, ruchowi v2 i stacji-portowi. Hala K-7 i zatoki (stanowiska, kolizje) są wspólne, różni je tylko ubiór. Zmiana ringu Ziemi nie dotyka Marsa i Jowisza, i odwrotnie. Opis: `docs/PORT-halo-ring.md` § „Ringi-archetypy”.

- Ring nie udaje życia (`docs/BRIEF-ring-halo.md` §1): bez ruchu zastępczego, zaparkowanych NPC i świateł aut — statki tylko z systemu ruchu.

- Ring na WebGPU (zadanie 06): biblioteka TSL `src/3d/haloRing/haloRingTSL.js` (odpowiednik `haloRingGLSL.js`, który
  po zadaniu 11 zostaje tylko dla budowli Z7 poza portem i narzędzia parzystości — tło menu czyta już TSL), uniformy ringu
  w jednym bloku (`createHaloUniforms`, klucze i `.value` bez zmian), mapy świata i detal pieczone w TSL. **Budowa ringu
  jest asynchroniczna:** `createHaloRing` wraca od razu (układ i uniformy gotowe), bryły i mapa CPU dopiero po
  `await ring.ready` (compileAsync bake'u na prawdziwych celach → bake → odczyt CPU → plan budowli i kopuł z mapy →
  `setCivic` → detal → rozgrzewka brył → podpięcie); `mapsReady` po odczycie, `terrainHeightAt` = 0 przed nim,
  `HaloRingGame` podpina teren do kolizji i zeruje stanowiska K-7 po `ready`. **Bryły trafiają do `group` dopiero po
  rozgrzewce** (zadanie 11): hak `options.prewarm(obiekty, opcje)` hosta — `HaloRingGame` przekazuje `Core3D.warmup.now`
  z kamerą wszystkich warstw — kompiluje pipeline'y nowego zestawu (i dachu hal K-7 w drugim stanie, `roofWarmVariant`)
  przed podpięciem; `ready` / `mapsReady` obejmują rozgrzewkę, ringi-archetypy (`createArchRing`) tak samo (bez haka —
  od razu, jak demo). Nowa część ringu = obiekt w `prewarmParts` (index.js) / liście brył archetypu, inaczej jej
  pierwsza klatka kompiluje się synchronicznie. Mapa CPU zgodna z WebGL do precyzji float (`scripts/webgpu/ring-mapa.mjs`),
  parzystość funkcji GLSL ↔ TSL: `scripts/webgpu/ring-tsl-parzystosc.mjs`, teren w koliderze gry:
  `scripts/webgpu/ring-kolizje-gra.mjs`; warsztat `dema/halo_ring_demo.html` na WebGPU.

- Teren ringu w TSL (zadanie 07): `HaloTerrain` = NodeMaterial z `makeHaloTerrainNodes` (`haloRingTerrain.js`, 1:1 z
  dawnym GLSL), uniformy powierzchni w bloku `haloSurfU` (`terrain.surfaceUniforms` — klucze i `.value` jak dawniej, mapy
  i detal to węzły `texture()`; te same uniformy dostaną struktura, atmosfera, megastruktura i miasto przez
  `haloRingSurfaceTSL(u, su)`). Jedyny wariant kompilacji to kroki powietrza (`quality.airSteps`), reszta jakości w
  uniformach. Zestaw przemysłowy: `haloIndKitTSL(u)` (`haloRingIndustryKit.js`), liczby z jednej definicji `kitParts` —
  na liczbach = bliźniak JS `indKitPart` bit w bit (`tests/haloRingTerrainTSL.test.mjs`), na GPU zero rozbieżnych decyzji
  (parzystość). `HALO_GLSL_SURFACE` usunięte w 09 (`CLOUDCOVER` w 08), `HALO_GLSL_INDKIT` leży w `haloRingGLSL.js`
  tylko dla narzędzia parzystości.
  Zrzuty samego terenu dema: `scripts/halo-ring-shots.mjs --teren [--bez-otoczenia]` (ten sam skrypt w worktree z tagu).

- Konstrukcja i atmosfera w TSL (zadanie 08): `HaloStructure` = NodeMaterial z `makeHaloStructureNodes`
  (`haloRingStructure.js`, 1:1 z dawnym GLSL); wierzchołek pasów obrotowych `haloStripVertexTSL` dzielą konstrukcja, chmury
  i powłoka. Warianty: górna ściana w FG (`haloFgClip` — zanik i wycięcia z `uFgFade` / `uCutA` / `uCutB`, które
  `ring.update` / `setCutaway` ustawiają z kamery TEJ klatki; przerzedzenie IGN z `haloFragCoordGL`) albo reszta bryły.
  Reguły komórek dachu to CZYSTE funkcje WGSL (`haloRoofIndCell`, `haloRoofPlot`, `haloRoofIndShadow`… — reguły profilu
  planety parametrami), klasa sektora z tablicy `uSectorClass` wklejana (`haloRoofTSL(u)`); zgodność z planem brył na
  CPU (`industrialCellRule` / `plotRule`): na GPU 0 rozbieżnych decyzji (`scripts/webgpu/ring-tsl-parzystosc.mjs`), w Node
  sole i progi (`tests/haloRingStructureTSL.test.mjs`). Chmury (`makeHaloCloudNodes`) i powłoka (`makeHaloShellNodes`):
  stan renderu jak dawny ShaderMaterial — chmury przezroczyste DoubleSide z `forceSinglePass: true`, powłoka BackSide
  z mieszaniem kolor + cel · alfa; warianty z jakości (kroki powietrza, oktawy chmur). Zrzuty części ringu: dema
  `scripts/halo-ring-shots.mjs --czesci terrain,structure,structureTop,clouds,shell`, gry `zrzuty.mjs --czesci-ringu`
  (sceny `ring-dach`, `ring-dach-z01`, `ring-habitat` — dach w FG i habitat z dala od portu).

- Megastruktura i miasto w TSL (zadanie 09): bryły dachu (FG) i doków, szkło kopuł, pociągi, światła pozycyjne
  (`haloRingMegastructure.js`) oraz ogrody, przemysł i drzewa (`haloRingCity.js`) = NodeMaterial 1:1 z dawnym GLSL;
  fragment brył `makeHaloPrimFragment` wspólny (miasto: wariant ścian z położenia lokalnego). Dawne `defines` to warianty
  budowane raz (dach nad płaszczyzną gry z `haloFgClip` / światła z `haloFgVisibility` vs doki bez), draw calle bez zmian.
  Wczesne wyjścia wierzchołków (dawne `collapse(); return;`) = zagnieżdżone gałęzie z domyślnym wierzchołkiem poza bryłą
  obcinania (mapy czyta tylko żywy wierzchołek — drzewo po mapie A, jak dawniej). Ziarna brył i hasze okien / paneli /
  fasad megabudowli liczą `a·b + c` przez `haloFma` (fma WGSL — ten sam rozkaz mad, który składał FXC w bazie):
  bez tego 28% brył świeciło innymi oknami (wzór losowany na nowo). Pozostałe różnice z bazą to piksele krawędzi i
  aliasing okien na budynkach 1–2 px (miasto z daleka, ściany pod ostrym kątem) — ten sam wzór, inne próbki.
  Zrzuty samych brył: dema `--czesci mega,city`, gry `zrzuty.mjs --czesci-ringu HaloMega_detail_box,…,HaloTrees`;
  baza dema z kopii tagu: `halo-ring-shots.mjs --repo <drzewo tagu>`.

- Hala K-7 i ringi-archetypy w TSL (zadanie 10 — ring bez zamienników i bez GLSL poza `haloRingGLSL.js`): K-7
  (`haloPortK7.js`) = GRAF NA RING, WARTOŚCI NA HALĘ: `k7Graphs(u)` buduje raz (cache po uniformach ringu) grafy
  instancji, płyt, napisów i węży; cztery hale dostają lekkie NodeMaterial-e na tych samych węzłach (jeden NodeBuilder na
  rodzaj i stan), wartości hali w `material.uniforms` — `uHub` / `uHallLights` / `uRoofOpacity` przez
  `uniform().onObjectUpdate`, macierze grup ruchomych (człony ramion paliwowych, wysięgniki, złączki, zamki pola) oraz emisja grup, lampy, paleta, emisja i
  poświata w dwóch `uniformArray` pakowanych PER OBIEKT (`k7Groups`, `k7Surf` — stałe nazwy buforów), atlas napisów
  węzłem tekstury per obiekt (`teksturaObiektu`, `src/3d/tsl/`). Dach (`K7RoofFade`) dalej przełącza `transparent` / `depthWrite` w
  `update()` (drugi stan = drugi pipeline, raz). Nowa wartość per hala = holder w `k7Uniforms` + pakowanie / `perObject`,
  nie nowy węzeł na halę. Archetypy (`arch/archTSL.js`, dawne `archGLSL.js`): partie instancji to `Mesh` z
  `InstancedBufferGeometry` i JEDNYM przeplecionym buforem (macierz, barwa, aInst — `ARCH_INST_STRIDE`), NIE
  `THREE.InstancedMesh` (uuid w kluczu programu = NodeBuilder na każdą z ~40 / ~100 partii); światła pozycyjne to
  kwadraty instancjonowane (nie `THREE.Points`); dawne `defines` (FG, atlas, barwy w wierzchołkach) = warianty budowane
  raz. Hasze okien / paneli / kratek i ziarno instancji liczą `a·b + c` przez `haloFma` / `haloFmaVec2` (zmierzone:
  100% bit w bit z bazą, `ring-tsl-parzystosc.mjs` wiersze `arch*`). Powierzchnie ECUMENE / Fable: pola wody i typu to
  czyste funkcje WGSL (uEcu w parametrze), pochodne linii Fable przed gałęziami stref, mapa stref NEAREST czytana
  `textureLoad`. Demo `halo_ring_demo`: post = `BloomGry` jak gra (od zadania 25b bez × 3 — bloom jak w demach WebGPU);
  porównanie samego ringu z bazą z tagu (do 25b; potem baza z `main`):
  `halo-ring-shots.mjs --czesci terrain,structure,structureTop,clouds,shell,mega,city,k7 --bez-otoczenia`.
