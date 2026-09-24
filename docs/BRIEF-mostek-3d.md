# Zadanie: model 3D mostka — Atlas, Bellator, Iron Skull (jedyny element 3D na kadłubie)

## Kontekst — co już jest

Mechanika mostków jest w grze od 2026-09-24 (zniszczenie mostka = utrata dowodzenia = kill):
- `src/game/shipBridge.js` — strefy heksów, integralność, oś czasu `BRIDGE_KILL_TIMELINE`, dane okien, transformacje.
- `src/game/shipBridgeRuntime.js` — klej gry (podpięcie po `initHexBody`, hulk po utracie dowodzenia, stan wizualny hulka).
- `src/3d/bridgeFx3D.js` — dzisiejsze okna (płaskie szczeliny, 1 draw call) i wyrzut atmosfery (bank `Fx3D`).
- Opis i mapa haków w `index.html`: `docs/PORT-mostki.md` §0.
- Demo: `npm run dev` → `/dema/mostki-demo.html` — te same trzy kadłuby na prawdziwym `Core3D` + `hexShips3D`, strzelanie w mostek, sekwencja utraty dowodzenia, API `window.__mostki` (setup, advance, shootBridge, zoomBridge, measureWindows…).

Strefy mostków (px PNG sprite'a, środek sprite'a = 0,0, +x = dziób) — `BRIDGE_LAYOUT_PROPOSALS` w `shipBridge.js`:

| kadłub | sprite (PNG → render) | strefa x, y, w, h |
|---|---|---|
| Bellator `battleship` | `src/assets/ships/terranbattleship.png` 1158×714 → 624×385 | `mostek` −282, 0, 236, 92 |
| Iron Skull `pirate_battleship` | `src/assets/ships/piratebattleship.png` 1158×632 → 720×393 | `mostek` −242, −2, 176, 104 |
| Atlas `atlas` (NPC i gracz) | `assets/capital_ship_rect_v1.png` 3747×1677 → 1800×806 | `mostek_rufowy` −735, −13, 520, 80 (główny) + `mostek_zapasowy` 632, −8, 244, 66 (dziób) |

Do świata: px PNG × `entity.__hardpointScaleX/Y` (render/PNG: Bellator 0,539, Iron Skull 0,622, Atlas 0,480) → np. Bellator ~127×50 j., Atlas główny ~250×38 j., zapasowy ~117×32 j. Zrzuty stref i dzisiejszych okien: `.tmp/mostki/strefa_*_zoom.png`, `.tmp/mostki/okna_*.png` (odtworzysz je: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON dema/mostki-shots.js --only zone_battleship,zone_pirate_battleship,zone_atlas`).

Stan w grze, z którego model ma czytać (nic nie liczy od nowa):
- `entity.bridgeState.bridges[i]`: `def` (strefa), `shards` (heksy strefy), `pos` (Float32Array środków komórek w px PNG), `total`, `alive`, `integrity`, `dead`, `deadAt`, `vent`.
- `entity.bridgeState`: `commandLost`, `commandLostAt`, `windows` (dane okien), `scaleX/scaleY`.
- Żywotność heksa: `bridgeShardIsAlive(grid, shard)`. Czas: `bridgeSimTime` (sekundy symulacji, stoi w pauzie) — ten sam, który dostaje `BridgeFx3D.update`.
- Transformacje: `bridgePngToWorld(entity, px, py, out, pose)` / `bridgeGridToWorld(entity, gx, gy, out, pose)`.
- Po utracie dowodzenia NPC jest hulkiem 4 s (`BRIDGE_KILL_TIMELINE.sequenceEnd`), potem `finishBridgeKill` (index.html) robi z niego wrak: heksy przechodzą do encji wraku, NPC znika, `bridgeState` zostaje zwolniony.

## Cel

Mostek ma być **trójwymiarową nadbudówką wystającą z kadłuba** — jedynym elementem 3D na kadłubie (kadłuby to płaskie meshe heksów z teksturą sprite'a). Ma dodać immersji: światło, połysk, cień na kadłubie, a w widoku perspektywicznym (tryb `free3d`, np. lot nad Ring City) — widoczną wysokość. **Obrażenia dostaje normalnie z 2D** (heksy strefy); silnik destrukcji 3D user doda później sam, tylko wizualnie.

## Jak gra rysuje (sprawdzone w kodzie)

- Jeden renderer: `Core3D` (`src/3d/core3d.js`). Nowe obiekty → `Core3D.scene`. Żadnego nowego `WebGLRenderer`, composera ani canvasu.
- Kamera gry: **ortograficzna, prosto z góry**. Świat (x, y) → scena (x, −y), +Z w stronę kamery. Warstwy: 0 = świat (pass ortho, kadłuby), 2 = FG (okna mostków, lampy pozycyjne), 1 = tło; 3/5/6/7 (planety, halo, ring, tarcze) mają kontrakt aktywności — nie używać. W trybie `free3d` (`Core3D.isFreePerspectiveCamera()`) obiekty warstwy 0 rysuje kamera perspektywiczna.
- Kadłuby: `src/3d/hexShips3D.js`, `InstancedMesh` heksów z własnym `ShaderMaterial` (`HEX_FRAGMENT_SHADER`: lakier `src/3d/hullLacquer.js`, normal mapy, spekular), `renderOrder` 10 (pancerz 9, Z −0,25). `castShadow = false` — **kadłuby nie rzucają i nie odbierają cieni three.js**.
- Światło kadłuba liczone per statek: `uLightDir = normalize(sun.x − x, −(sun.y − y), 600)` (`window.SUN`). Słońce jest daleko, więc pada **niemal poziomo** — użyj tego samego kierunku, żeby model pasował do kadłuba (strona od słońca jasna, odwrotna ciemna, długi cień).
- Cień mostka na kadłubie zrób sam (np. rzutowany, miękki kształt w stronę od słońca, przycięty do sylwetki kadłuba) — shadow mapa go nie da. Cień kadłubów w passie shafts (`src/3d/hullShadowSdf.js`) należy do innej sesji — nie ruszać bez uzgodnienia.
- Bloom HDR-first (`src/3d/bloomConfig.js`, próg ~0,9, ACES w uber-passie): świecić mają tylko emitery > 1. Zmierzone pasma dzisiejszych okien (bez bloomu): Bellator p50 0,54 / p99 1,6; Iron Skull ≤ 0,83 (brudny pomarańcz, bez bloomu); Atlas p99 1,46. Kolory okien: Bellator `#e4f3ff`, Atlas `#d6ecff`, piraci `#ff9a4a`. Zero poświaty wzdłuż sylwetki.
- Gracz jest rysowany z pozą interpolowaną (`window.__interpShipPose`), NPC — z fizyczną. Model na statku gracza musi iść za tą samą pozą (jak `BridgeFx3D`: opcja `poseOf`, w grze `bridgeRenderPose`).
- Heksy się deformują (`shard.gridX + shard.deformation.x`); okna w `bridgeFx3D` idą za deformacją. Model może być sztywny, ale nie może wisieć nad dziurą.
- Culling: tylko to, co w kadrze — to samo pudło co `updateHexShips3D` (`_hexCullInfo` w `index.html`).

## Wymagania

1. **Trzy style**, pasujące do namalowanej nadbudówki pod strefą (model stoi dokładnie w strefie i wizualnie ją zastępuje):
   - Bellator — czysta biel/szarość Terran, panele, anteny, kopułki sensorów;
   - Iron Skull — rdza, nity, łaty, kolce, brud (pasuje do sprite'a z czaszkami);
   - Atlas — granat/grafit z cyjanowymi akcentami; dwa mostki: długi rufowy na kręgosłupie i mniejszy zapasowy na dziobie.
   Najpierw obejrzyj sprite'y i zrzuty stref.
2. **Z góry wysokość czyta się tylko przez światło i cień**: stopnie/tarasy, fazy, skośne ściany; okna na **skośnych** płaszczyznach (pionowych ścian z góry nie widać); maszty, anteny, kopuły rzucające cienie. Wysokość umiarkowana (rząd 10–25 j. przy szerokości strefy 30–65 j.), żeby nie gryzła się z płaskim, malowanym kadłubem.
3. **Obrażenia z 2D**: tam, gdzie heksy strefy zginęły, w modelu jest wyrwa (części nad martwymi komórkami znikają, brzegi ciemne/żarzące się jak brzegi ran `_heatWoundRim`). Źródło prawdy: `bridge.shards` + `bridgeShardIsAlive`. Nic w 3D nie zmienia gameplayu (kolizje i obrażenia zostają w 2D). Model podziel na moduły/kawałki, żeby dało się później podpiąć wizualny silnik destrukcji 3D.
4. **Okna i światła modelu** wg `BRIDGE_KILL_TIMELINE`: `sampleWindowLight` + fala od wyrwy `bridgeWaveDelay` (jak w `bridgeFx3D.js`), migotanie uszkodzonych, mostek zapasowy Atlasa gaśnie osobno, gdy padnie wcześniej. Gdy model ma własne okna — wyłącz szczeliny w `bridgeFx3D` (bez podwójnych okien); wyrzut atmosfery zostaje w `bridgeFx3D`.
5. **Wydajność**: do 174 okrętów w bitwie. `InstancedMesh` (jeden lub kilka na typ modelu), atrybuty instancji, zero alokacji w pętli klatki; podaj liczbę draw calli i koszt ms. Daleko (mały na ekranie) → wygaszenie/LOD jak okna (`BRIDGE_FX_TUNE.minPx/fullPx`).
6. **Hulk → wrak**: po 4 s agonii NPC staje się wrakiem. Zdecyduj i opisz, czy model przechodzi na wrak (zgaszony — lepszy łup do holowania), czy znika — bez nagłego „pyknięcia”.

## Jak pracować

- Zacznij w demie `dema/mostki-demo.html`. Potem wepnij do gry jednym hakiem obok `BridgeFx3D.update(...)` w `render()` (`index.html`, tuż przed `updateHexShips3D`) i `attach` obok `BridgeFx3D.attach` (po `initHexShips3D`).
- Twoje pliki: `src/3d/bridge3D.js` (+ ewentualnie `src/3d/bridge3DShapes.js`), `tests/bridge3D.test.mjs`, nowa sekcja w `docs/PORT-mostki.md`. Pliki gry zmieniaj minimalnie (haki). `destructor.js` i `hullShadowSdf.js` należą do innych sesji — bez uzgodnienia nie ruszać.
- Wygląd sprawdzaj sam: headless Chrome przez CDP (wzorzec `dema/mostki-shots.js`), zrzuty do `.tmp/mostki3d/`: każdy kadłub z bliska i z daleka — cały / uszkodzony / hulk po utracie dowodzenia; pomiar HDR okien (jak `measureWindows` w demie). Nie proś usera o ręczne sprawdzanie — gameplay testuje sam.
- `npm run build` wywraca się na brakującym `AISPACE.html` — build tymczasowym configiem Vite (input = `index.html` albo demo; config bez importu `vite`, zwykły obiekt z `root` = repo). `node --check` nie łapie błędów ESM. Backtick w komentarzu GLSL wewnątrz template stringa kończy string.
- W drzewie są niezacommitowane zmiany usera i innych sesji: bez `git stash/checkout/reset/clean`, bez commitów. Inne sesje edytują równolegle `index.html` — zmieniaj go krótkimi, jednoznacznymi edycjami.
- Zasady z `AGENTS.md`: jeden renderer (`Core3D`), zero alokacji per klatka, HDR-first, warstwy wg kontraktu, komentarze po polsku.

## Na koniec

Raport: zrzuty trzech kadłubów (cały / uszkodzony / hulk), liczba draw calli i koszt ms przy 174 okrętach, pasma HDR okien, decyzje (wrak, LOD, cień), otwarte kwestie. Aktualizacja `docs/PORT-mostki.md`.
