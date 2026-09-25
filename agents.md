# AGENTS.md — aktualny przewodnik dla agentów

> **Cel pliku**: krótki, praktyczny opis aktualnej architektury gry „Super Capital: Battle for Solar System” i miejsc integracji. Trzymaj się tych zasad, żeby nie psuć gameplayu i wydajności.

---

## Szybka mapa repozytorium

- **`index.html`** — główna pętla gry i warstwa **2D Canvas** (sterowanie, fizyka, strzały, HUD, UI).
- **`src/3d/core3d.js`** — **jedyny współdzielony rdzeń WebGL** (`renderer`, `scene`, `camera`, `composer`, bloom, alpha pass).
- **`src/3d/hexShips3D.js`** — aktualizacja i render statków/hexów 3D; końcowe wywołanie renderu 3D (`Core3D.render()`) i kopiowanie na 2D.
- **`src/3d/world3d.js`** — obiekty świata 3D (np. piracka stacja), podpinane do `Core3D.scene`.
- **`src/3d/stations3D.js`** — stacje 3D, podpinane do `Core3D.scene`.
- **`planet3d.assets.js`** — aktywna warstwa planet/słońca (API globalne: `initPlanets3D`, `updatePlanets3D`, `drawPlanets3D`).
- **`planet3d.proc.js`** — wariant legacy/proceduralny (nie używać jako głównej ścieżki bez wyraźnej potrzeby).
- **`src/3d/haloRing/`** — ring „Halo” Ziemi i Marsa (teren, miasta, megastruktura, port K-7); klej gry `haloRingGame.js`, kolizje `src/game/haloRingCollision.js`. Opis: `docs/PORT-halo-ring.md`.
- **`src/game/destructor.js`** — silnik destrukcji heksów (fizyka kolizji, deformacje, splity, debris).
- **`src/game/shipEntity.js`** — konfiguracja i geometria statku gracza (fizyka wejścia, offsety, thrusters, hardpointy).
- **`package.json`** — serwer dev i zależności.

---

## Pipeline renderowania (aktualny)

1. **Gameplay i fizyka** dzieją się w 2D (`index.html`, `destructor.js`, logika broni/NPC/HUD).
2. W `render(alpha, frameDt)` aktualizowane są moduły 3D:
   - `updatePlanets3D(frameDt, cam)`
   - `haloRings.update(frameDt, cam, …)` (ring „Halo”)
   - `updateStations3D(stations)`
   - `updateWorld3D(frameDt, vfxTime)`
   - `updateHexShips3D(cam, hexEntities)`
3. Finalna klatka WebGL jest kopiowana na główny canvas przez `drawHexShips3D(ctx, W, H)`.
4. HUD/overlays 2D są rysowane na końcu.

**Zasada żelazna**: _Nie twórz nowych instancji `THREE.WebGLRenderer` poza `Core3D`._

---

## Kluczowe byty gry

### Świat i kamera
- `WORLD` — rozmiar mapy.
- `camera` — zoom, limity, tryby śledzenia/focus.

### Planety i słońce
- `initPlanets3D(planets, SUN)` — inicjalizacja.
- `updatePlanets3D(dt, cam)` — aktualizacja.
- Planety są częścią wizualnej warstwy 3D, gameplay nadal jest liczony w 2D.

### Ring „Halo” (Ziemia, Mars)
- `HaloRingGame` (`src/3d/haloRing/haloRingGame.js`): BG warstwa 1, górna ściana i suwnice K-7 w FG (warstwa 2). `haloRings.update(frameDt, cam, …)` co klatkę PRZED `Core3D.render`, z kamerą TEJ klatki (`cam` ze wstrząsem) — ring liczy pozycje względem kamery (RTE), inna kamera przesunie go względem statków. Jakość = `OPTIONS.planetQuality` („Ultra” = dalszy LOD, `HALO_LOD_ULTRA`).
- Ring jest PRZESZKODĄ w płaszczyźnie gry: płyta podłogi z terenem, przelot tylko 4 tranzytami (`stepShipRingCollisions`, `haloRings.pointInSlab` dla pocisków). Nowe ruchy statków przy Ziemi/Marsie (spawny, teleporty, autopiloty) muszą tę płytę omijać.
- Stacja Ziemi i Marsa = stacja-port w hali K-7 (`ringPort`, `isCollidable: false`, `terminalRange`) — wyglądem stacji jest ring: nie rysuj dla niej brył ani ikon stacji.
- Ring nie udaje życia (`docs/BRIEF-ring-halo.md` §1): bez ruchu zastępczego, zaparkowanych NPC i świateł aut — statki tylko z systemu ruchu.

### Stacje i obiekty 3D
- `updateStations3D(stations)` — synchronizacja stacji 2D -> 3D.
- `updateWorld3D(dt, t)` — aktualizacja obiektów świata 3D.

### Statek gracza
- Obiekt `ship`: pozycja, kąt, prędkość, masa, shield/hull.
- Sterowanie i fizyka gracza: `shipEntity.js`.
- Destrukcja i kolizje heksów: `destructor.js`.

### Mostki (zniszczenie mostka = kill)
- `src/game/shipBridge.js` (strefy heksów, integralność, oś czasu), `src/game/shipBridgeRuntime.js` (klej gry), `src/3d/bridgeFx3D.js` (okna, wyrzut atmosfery). Opis: `docs/PORT-mostki.md`.
- Utrata dowodzenia robi z NPC hulka (`isBridgeHulk`): `npcStep` pomija AI i model lotu, `applyDamageToNPC` i sufit heksów go nie ruszają, po `BRIDGE_KILL_TIMELINE.sequenceEnd` `finishBridgeKill` robi wrak BEZ losowego wybuchu reaktora. Nowe ścieżki śmierci / AI / celowania muszą to respektować.
- AI celowo nie celuje w mostki (za szybko zabijałoby gracza) — tylko przyszli „bossowie”.
- Model 3D mostka: `src/3d/bridge3D.js` (+ `bridge3DShapes.js`), `docs/PORT-mostki.md` §8. Wyrwy tylko z heksów 2D (tekstura obrażeń), nic nie zmienia gameplayu. Cień na kadłubie to prostokąt POD kadłubem z `depthFunc GREATER` — działa, bo kadłuby (renderOrder 10) piszą głębię w passie ortho na z ≈ 0; zmieniając głębię/z kadłubów, sprawdź cień mostka. `bridgeState.model3D` wyłącza szczeliny okien w `bridgeFx3D` (wyrzut atmosfery zostaje). Model przechodzi na wrak sam, po przynależności heksów — nie dokładaj haków w `finishBridgeKill`.
- **Nowy kadłub (nowy albo podmieniony sprite okrętu) = od razu mostek**: strefa w `BRIDGE_LAYOUT_PROPOSALS`, model w `bridge3DShapes.js`, paleta w `bridge3D.js` — checklista `docs/BRIEF-mostek-nowego-kadluba.md`. Mostki ma cała flota bojowa (Terra Nova, piraci, Atlas) i lokomotywa megafrachtowca; frachtowce cywilne i myśliwce nie.

### Silniki: MAIN, WARP, SIDE
- `src/3d/engineVfxSystem.js` rozdziela dysze: MAIN → `mainExhaust3D.js` (struga + iskry z `Fx3D.spark`, jedna pula na flotę), WARP → `warpPlume3D.js` (plazma z tych samych dysz MAIN na czas ładowania/skoku, pula z limitem `WARP_PLUME_CAP`, nadmiar dostaje strugę MAIN z dopalaczem), SIDE → stary `engineExhaustBatch.js`.
- Rozmiar i palety MAIN/WARP są PER STATEK: blok `engineFx` w danych edytora (`hpEditor.v1` → `ships[id]`), domyślne dopasowane do sprite'ów w `src/data/engineFx.js` (`ENGINE_FX_DEFAULTS`). Dysza w pikselach PNG, w grze × hpScale × spriteScale (jak markery). Gra czyta `visual.engineFx` (runtime NPC, układ gracza); nowy kadłub z dyszami MAIN potrzebuje wpisu w `ENGINE_FX_DEFAULTS` (pilnuje test).
- Tryb skoku encji: gracz z `GameState.warp`, NPC `state === 'warping_in'` / `phase === 'warping'`, podgląd edytora `__warpPreview`. Dopalacz MAIN: `GameState.boost`.
- Gorące powietrze dysz = port maski z dema plazmy w uberPass (`Core3D`): źródło z kierunkiem (`pushHeatHazeWorld(..., dirX, dirY)`) to DYSZA — `radiusWorld` = promień wylotu, siła = rampa mocy; stożek 7R zaczyna się ~1R za wylotem (dysze siedzą na krawędzi kadłuba), przesunięcie ~0,12 promienia dyszy na ekranie. Źródła bez kierunku (wybuchy, rakiety, tarcze) liczą się po staremu.
- Shadery efektów w passie ortho: bez `pow()` z możliwie ujemną podstawą i z clampem varyingów — MSAA ekstrapoluje je poza trójkąt, a NaN w buforze HalfFloat bloom rozlewa na cały ekran.

### Wraki: gorące, śpiące, zimne
- `wrecks` = gorące i śpiące (`_wreckSleeping`); `coldWrecks` = zimne (`src/game/coldWrecks.js`, brief `docs/BRIEF-zimne-wraki.md`). Zimny wrak nie ma `hexGrid` (stan siatki w `_coldSnapshot`), nie jest w `wrecks`, siatce pocisków, listach destruktora ani `renderEntities` — rysuje go tylko batch smug. Łup i ładunek zostają na obiekcie.
- Budzenie WYŁĄCZNIE jawne: `thawWreck(w, reason, onReady)` (holowanie, cięcie, rozkaz), max 1 na klatkę. Nowa ścieżka usuwająca wraki obsługuje też `coldWrecks` (`coldWreckSystem.forget`), a nowe odwołanie do wraku (cel, lina, rozkaz) trzeba stemplować w `markColdWreckReferences` — inaczej wrak zamarznie pod ręką.

### Pociski, kolizje, efekty
- Tablice `bullets`, `particles`.
- `bulletsAndCollisionsStep(dt)` — ruch, trafienia, eksplozje, applyImpact.

### Wejście i HUD (aktualne skróty)
- `W/S` — ciąg przód/tył
- `Q/E` — strafe
- `A/D` — obrót
- `LPM` — rail
- `PPM` — rakiety/specjal zależnie od stanu
- `F` — specjal
- `Shift` — warp/boost (kontekstowo)
- `M` — mapa
- `X` — scan
- `T` — lock target
- `R` — repair/heal (destructor)
- `P` — panel wydajności
- `Space` — pauza

---

## Miejsca do pracy dla agentów

> **Krytyczna zasada**: gameplay (fizyka, kolizje, damage, input) pozostaje źródłem prawdy w **2D**. 3D jest warstwą renderingu.

1. **Core3D (`src/3d/core3d.js`)**
   - Modyfikacje renderera/composera/blooma/alpha-pass rób wyłącznie tutaj.
   - Parametry bloomu (strength/radius/threshold, także dla overlay3D) żyją w `src/3d/bloomConfig.js` — jedyne źródło prawdy; tuner (panel Bloom) nadpisuje je trwale tylko z `?dev` w URL.
   - Pipeline jest HDR-first: emitery (pociski, beamy, dysze) mnożą kolory >1.0, próg bloomu ~0.9 odcina zwykłe powierzchnie. Nowe efekty, które mają świecić, muszą wypychać luminancję >1.
   - Nie duplikuj postprocessingu w innych modułach.
   - Passy planet (warstwa 3), halo (5), ring-planet (6) i tarcz (7) są pomijane, gdy nikt nie zgłosi na nich widocznej zawartości (`Core3D.layerActivity`). Dodając obiekt na te warstwy, zgłaszaj go co klatkę (`Core3D.markPlanetLayersActive` / `Core3D.setShieldLayerActive`) — inaczej zniknie.
   - Shadow mapa słońca ma `autoUpdate = false`; odświeża się tylko przed passami ortho i FG. Nowy rzucający cień na innej warstwie wymaga `shadowMap.needsUpdate` przed jej passem.
   - Soczewka skoku (warp) to pass Core3D zaraz po tle (`src/3d/warpLens3D.js`): przy aktywnej tło (warstwa 1) idzie do `warpLensTarget`, a `warpLensPass` kładzie je zakrzywione pod planety, statki i FG, przed bloomem. Gra zgłasza ją w świecie co klatkę PRZED `Core3D.render` (`setWarpLensWorld` / `clearWarpLens`, klej: `src/vfx/warpLensPass.js`). Nie próbkuj gotowej klatki 2D i nie wycinaj statku maską — tak powstało „jajko” wokół kadłuba.
   - Cienie słońca (shadow shafts) to MASKA widoczności, nie filtr obrazu: `Core3D._renderSunShadowMask` liczy ją raz na klatkę przed pre-passem halo (`sunShadowTarget`, `src/3d/sunShadowMask.js`; R = cień powierzchni, G = smuga tła z ringami). Nowy materiał oświetlany słońcem w płaszczyźnie gry dostaje `sunShadowUniforms` + `SUN_SHADOW_GLSL` i mnoży przez `sunVisibility()` człon słońca, a otoczenie przez `sunFill()` (w pełnym cieniu `SUN_SHADOW_FILL` = 0,4); światła, żar i glow zostają; tło — `sunShaftBackdrop`; wbudowane materiały three — `applySunShadowToBuiltinMaterial`. Emitery (broń, dysze, błyski, światła pozycyjne, tarcze) i ring „Halo” (własny model słońca) maski NIE czytają. Nie przywracaj quada mnożącego gotowy obraz — gasił broń z warstwy 0 pod progiem bloomu i kładł drugi cień na ring.
   - Cień kadłubów w passie shadow shafts = pole odległości sylwetki (`src/3d/hullShadowSdf.js`: warstwa tablicy tekstur na kształt, pieczenie z budżetem w `updateHexShips3D`). Okluder statku zgłaszaj przez `Core3D.pushShaftHullSdf` z danymi z `packHullShaftOccluder` (to samo przekształcenie co mesh kadłuba). Zmieniając `HULL_SDF_SHADOW_GLSL`, zmień też lustro `traceHullShadowCpu` — na nim stoją testy.

2. **Moduły 3D (`world3d.js`, `stations3D.js`, `hexShips3D.js`)**
   - Używaj `Core3D.scene` i `Core3D.camera`.
   - Nie twórz lokalnych rendererów ani dodatkowych canvasów WebGL.
   - Świat leży przy 5–10 mln j.: pozycja świata liczona na GPU we float32 drga ~1 px względem kadłubów. Nie wpisuj bezwzględnych pozycji do macierzy instancji ani atrybutów — duży offset w `mesh.position` (three składa `modelViewMatrix` w double), dane względem niego, w shaderze `modelViewMatrix * instanceMatrix`. Wzór: `Bridge3D._setOrigin` (`docs/PORT-mostki.md` §8.12).
   - Początek przy kamerze daje `sceneOriginNearCamera` (`src/3d/sceneOrigin.js`); dane przepisywane co klatkę — początek co klatkę (np. `shipLights3D.js`, `fxParticles3D.js`), bufor pisany raz przy emisji (pierścień) — początek „lepki” z przesunięciem żywych danych dopiero po odjeździe kamery (`sparkSystem3D.js`, `slugTrail3D.js`). Pozycje świata w pulach CPU: `Float64Array`. Pomiar przed/po: `dema/precyzja-drzenie.js` (bloom wyłączaj przez `bloomPass.enabled` — sam `perfToggles.bloom = false` go nie wyłącza).

3. **Destruction + ship integration**
   - Zachowaj spójność osi/rotacji między `shipEntity.js` i `destructor.js`.
   - Unikaj alokacji w gorących pętlach (kolizje, spatial queries, contact buffers).
   - Krok fizyki `PHYS_HZ` domyślnie 120 Hz (`?physHz=60` do testów A/B). Nowe stałe „na krok” (mnożniki tłumienia, liczniki w tickach) tylko przez `stepDecay120` / `ticksAt120` z `src/game/stepDecay.js` — inaczej zmiana kroku zmienia zachowanie gry.
   - `hexGrid.grid` jest indeksowana komórką POCZĄTKOWĄ heksa, a wgnieciony heks stoi do `_maxHexDrift` px dalej. Szukanie heksów w oknie komórek (sondy trafień, raymarch wiązki) musi doliczyć `getHexProbeDrift(grid)` — inaczej heksy-duchy: pocisk przelatuje przez wgniecenie. Trafienie, które zna heks, podaje go do `applyImpact(..., { shard })` (w `index.html`: `applyHexImpact`), zamiast szukać drugi raz.
   - Solver sprężyn GPU kroczy w czasie gry (`gpuSoftBodyHz` = 60), nie w klatkach renderu; liczniki dispatchera są w krokach 60 Hz.

4. **Wydajność**
   - Bez nowych alokacji per-frame tam, gdzie da się użyć pooli/buforów.
   - Profiluj przez `PerfHUD` (`performance.now()`), szczególnie: physics/draw/3D update.

5. **Kolejność rysowania**
   - 3D world pass -> 2D world/HUD.
   - Nie przywracaj starych, równoległych ścieżek `drawPlanets3D`/`drawStations3D`/`drawWorld3D` jako osobnych finalnych passów, jeśli render jest już zunifikowany przez `Core3D`.

---

## Konwencje PR dla agentów

- Nie dodawaj frameworków ani bundlera.
- Trzymaj zmiany małe i izolowane.
- Nie zmieniaj API bez potrzeby i opisu skutków.
- Zachowuj kompatybilność warstwy grywalnej 2D.


### Lista kontrolna PR
- [ ] Brak nowych rendererów WebGL poza `Core3D`.
- [ ] Brak alokacji w pętli render/update tam, gdzie były bufory/pule.
- [ ] Brak regresji sterowania i kolizji 2D.
- [ ] Spójność osi/rotacji (sprite, thrusters, impact/local transforms).
- [ ] Mierzalna poprawa lub brak regresji FPS.

---

## FAQ


**Gdzie dodawać nowe efekty 3D?**
W `src/3d/*`, z wykorzystaniem `Core3D`.

**Czy można dodać drugi bloom/composer lokalnie w module?**
Nie. Postprocessing powinien być centralny w `Core3D`.

**Jak zostawić notatkę dla kolejnych agentów?**
Dodaj TODO z prefiksem `AGENT:`.

**Jak dodać nowy statek (kadłub)?**
Sprite: `HULL_RENDER_PROFILES` (`src/data/ships.js`), `HULL_SPRITE_PATHS_BY_ID` i `getNpcHullRenderProfileId` (`index.html`); układ gniazd w `hardpointEditorDefaults.js`; dysze MAIN w `ENGINE_FX_DEFAULTS` (`src/data/engineFx.js`); **mostek** (strefa + model 3D) wg `docs/BRIEF-mostek-nowego-kadluba.md`.

---

> Uwaga techniczna: trzymaj `AGENTS.md` oraz grę w kodowaniu UTF-8.