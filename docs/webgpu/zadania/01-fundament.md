# Zadanie 01 — Fundament: WebGPURenderer w Core3D, zamienniki, adapter uniformów, harness na WebGPU
Zależności: — (Faza 0 zakończona) | Równolegle z: nie | Zalecany effort: max
Zakres: `src/3d/core3d.js` (renderer, start, passy scen bez EffectComposer, resolve + blend halo + „uber” bez gorącego
powietrza i bez bloomu, info, zegar GPU, cienie per światło, martwy split, warp jako no-op), `index.html` (import map,
start), `vite.config.js`, nowy katalog `src/3d/tsl/` (`uniformy.js`, `zamiennik.js`, `kolorGry.js`),
wywołania `renderer.compile` w `hexShips3D.js`, `shield3D.js`, `weapon3DSystem.js`, `src/ui/perfHud.js` (jeśli trzeba),
testy struktury Core3D. Materiały: 3 małe pełnoekranowe (resolve, blend halo, uber-lite), ~20 linii GLSL.

## Cel
Gra na `main` startuje na `WebGPURenderer` (jedyny renderer, jedna ścieżka) i jest grywalna: to, co ma materiały
wbudowane three, rysuje się normalnie, każdy nieprzeniesiony `ShaderMaterial` jest widocznym magentowym zamiennikiem
liczonym przez harness. Składanie klatki, kamery, warstwy, podzielony ekran i API `Core3D` działają jak dziś.

## Przeczytaj najpierw
`agents.md`, `docs/webgpu/USTALENIA.md`, `docs/webgpu/PLAN.md` (§1–§4, §6–§7), `docs/webgpu/SPIKE.md` (wszystko —
to zadanie wdraża jego wnioski), `docs/webgpu/POSTEP.md`, `src/3d/core3d.js` w całości, `dema/webgpu-spike.js`
(działające wzorce: renderer z limitami, `QuadMesh`, `RenderPipeline`, zamiennik, adapter uniformów), `drawHexShips3D`
w `src/3d/hexShips3D.js`, `scripts/webgpu/zrzuty.mjs` i `harness-strona.js`.

## Kroki
1. **Import:** w `index.html` import map dopisz `three/webgpu` → `./node_modules/three/build/three.webgpu.js`,
   `three/tsl` → `./node_modules/three/build/three.tsl.js`; w `vite.config.js` `optimizeDeps.include:
   ['three', 'three/webgpu', 'three/tsl']`. Sprawdź w grze (Vite) jeden rdzeń: `THREE.Mesh === (await import('three/webgpu')).Mesh`.
2. **`src/3d/tsl/`:**
   - `uniformy.js` — `uniformsAdapter(map)`: `UniformNode`/`TextureNode` wystawiają `.value`; `uniformArray` — `.value`
     → `node.array` (SPIKE 3). Opcjonalnie `makeUniforms({ uFoo: 1, uVec: new Vector2() })`.
   - `zamiennik.js` — klasa `ZamiennikMaterial extends NodeMaterial` (magenta, `isPlaceholder = true`, licznik budów,
     jedno ostrzeżenie na nazwę materiału — nie na klatkę); `installPlaceholders(renderer)` rejestruje ją dla
     `'ShaderMaterial'` i `'RawShaderMaterial'` przez `renderer.library.addMaterial` (SPIKE 15).
   - `kolorGry.js` — `acesGry(c)` (wzór z `UberPostShader`: Narkowicz bez ÷0,6, clamp 0…1) i `linearDoSrgb(c)` (wzór
     `LinearTosRGB` gry) jako `Fn` TSL.
3. **Renderer w `Core3D.init()`:** `import * as THREE from 'three/webgpu'` (rdzeń + `WebGPURenderer`, materiały węzłowe,
   `RenderPipeline`, `QuadMesh`). Konstruktor: `{ canvas, alpha: true, antialias: false, trackTimestamp: true,
   requiredLimits }` — limity z `navigator.gpu.requestAdapter()` (lista w PLAN §2). Część synchroniczna jak dziś (scena,
   kamery, cele, światła — moduły wołają `Core3D.init()` i od razu dokładają obiekty: `hexShips3D.js:2236`,
   `planet3d.assets.js:1072`, `index.html:9580`), więc **`isInitialized` zostaje true po części synchronicznej**, a nowe
   `Core3D.gpuReady` / `Core3D.ready` (Promise z `await renderer.init()`) bramkują wszystko, co potrzebuje urządzenia:
   `render`, `renderSingle`, `renderBackdrop`, `queueTextureUpload` (`initTexture`), `compileAsync`, pieczenie i odczyty.
   Po `init`: `highPrecision = true`, `outputColorSpace = LinearSRGBColorSpace`, `toneMapping = NoToneMapping`,
   `info.autoReset = false`, `installPlaceholders(renderer)`. **Tylko WebGPU** (decyzja użytkownika, PLAN §2 / §12 p. 2):
   przed utworzeniem renderera `navigator.gpu?.requestAdapter()`; brak adaptera → komunikat w menu „Gra wymaga
   przeglądarki z WebGPU” (zamiast startu gry) i bez tworzenia renderera; po `init()` warunek
   `backend.isWebGPUBackend` (inaczej ten sam komunikat) — zapasu WebGL2 three nie dopuszczamy.
4. **Cele:** `RenderTarget` (nie `WebGLRenderTarget`): `composerTarget` HalfFloat MSAA 4, `planetHaloTarget` MSAA jak
   scena, `postTarget` (jeśli dalej potrzebny), `sunShadowTarget` RGBA8, `refractionTarget` pół rozdzielczości.
   `setMsaaEnabled`: `rt.samples = n; rt.dispose()` (SPIKE 17). `capabilities.isWebGL2` znika.
5. **Passy scen bez `EffectComposer`:** mały runner w `Core3D` (bez `RenderPass`/`Pass`/`FullScreenQuad` z addons):
   tło (warstwa 1, czyści kolor i głębię) → planety (3) → blend halo (quad addytywny z `planetHaloTarget`) →
   ring-planety (6, ortho) → ortho (0) → tarcze (7, BEZ czyszczenia głębi) → FG (2); wszystko do `composerTarget`,
   `autoClear = false`, czyszczenie głębi przez `renderer.clear(false, true, false)`. Zachowaj `layerActivity` /
   `_scenePassHasContent`, `perfToggles`, `_syncSceneMatrices` (raz na klatkę), kubełki `lastFrameRenderInfo`
   (`_wrapRenderInfoPass` może zniknąć, jeśli runner mierzy sam — zachowaj nazwy kubełków: harness i PerfHUD je czytają).
   Pre-pass halo (`overrideMaterial` z `colorWrite = false`, SPIKE 12) przenieś od razu — to 2 rendery bez shadera.
6. **Post (wersja podstawowa):** `RenderPipeline` z `outputColorTransform = false` i `outputNode =
   vec4(linearDoSrgb(acesGry(texture(composerTarget.texture).rgb)), a)`. Bloom i gorące powietrze — zadanie 02; maska
   słońca — zadanie 03 (do tego czasu `sunShadowUniforms.uSunShadowOn.value = 0`, pass maski nie rysuje).
   `renderBackdrop` (tło menu) idzie tym samym postem.
7. **Cienie:** `renderer.shadowMap.enabled/type` zostają; `shadowMap.autoUpdate/needsUpdate` z WebGL znikają. Słońce
   (`planet3d.assets.js:1010`, `this.sunLight`) zgłasza się do `Core3D` (np. `Core3D.setSunShadowLight(light)`): na
   starcie `render()` raz `light.shadow.autoUpdate = false; light.shadow.needsUpdate = true` (SPIKE 9). Snapshot
   refrakcji niczego tu nie zmienia (aktualizacja najwyżej raz na klatkę).
8. **`renderer.info`:** `_readRenderInfoInto` czyta `render.drawCalls` (nie `render.calls`); reset ręczny raz na klatkę.
   `window.__rendererInfo.calls` = draw calle.
9. **Zegar GPU:** `_initGpuTimer/_gpuTimerBegin/_gpuTimerEnd/_gpuTimerPoll` z `EXT_disjoint_timer_query_webgl2` →
   jedno zapytanie w locie: po klatce `renderer.resolveTimestampsAsync('render').then(ms => this.gpuFrameMs = ms)`,
   nowe dopiero po rozwiązaniu (bez narastania Promise). PerfHUD czyta `Core3D.gpuFrameMs` (`perfHud.js:1546`).
10. **Split:** usuń gałąź split z runnera passów, `renderSplitScreen`, `_renderDirect`, pola `activeCam2` w passach
    (gra robi split przez 2× `renderSingle` w `drawHexShips3D` — zostaje). `clear()` w WebGPU ignoruje nożyczki (SPIKE 13).
11. **Warp (poza portem):** `setWarpLensWorld`, `clearWarpLens`, `setWarpViewWorld`, `clearWarpView`,
    `pushWarpSpaceWorld`, `pushWarpWaveWorld`, `setWarpStarsObject`, `suppressShadowShafts` zostają jako bezpieczne
    no-opy (sygnatury i zwracane wartości jak dziś, bez rysowania). Usuń `warpLensPass`, `warpLensTarget`,
    `warpStarTarget`, `renderPassWarpStars`, import `warpLens3D.js` z `core3d.js`, fale w uberze. W `render()` zostaw
    komentarz-miejsce: „pass zgięcia tła (nowy warp) — zaraz po passie tła, przed planetami”.
12. **`renderer.compile`** (`hexShips3D.js:2257`, `shield3D.js:1159`, `weapon3DSystem.js:863`) → `compileAsync(...)` bez
    blokowania, z `.catch` (log). `menuBackdrop3D.js` i `haloRingWorldGen.js` — tylko tyle, żeby nie rzucały
    (przeprojektowanie rozgrzewki: zadania 06 i 11). `compileAsync` w WebGPU kompiluje dla bieżącego celu, warstw kamery
    i frustum (PLAN §6) — poprawną rozgrzewkę robią zadania modułów; tu wystarczy, że wywołania nie rzucają. Warto
    dodać w `Core3D` pomocnik `prewarmPass(object3d, layer)` (cel `composerTarget`, kamera passa z warstwą,
    `frustumCulled = false` na czas kompilacji) — moduły 04, 12, 14 skorzystają.
13. **Kanwa i składanie:** bez zmian (`#webgl-layer` → kopia do `#c` w `drawHexShips3D`). Sprawdź harnessem, że kopia
    działa w każdej scenie (w tym `split`).
14. **Harness:** `node scripts/webgpu/zrzuty.mjs --backend webgpu --out .tmp/webgpu/zadania/01 --baza .tmp/webgpu/baseline/webgl/p1`.
    `wyniki.json`: `renderer` = `webgpu`, `spis.zamienniki` > 0 (spis to lista do kolejnych zadań — przepisz liczby
    per scena do `POSTEP.md`), zero błędów walidacji WebGPU / WGSL. Jeśli harness wymaga zmian pod WebGPU (np. odczyt
    HDR), popraw go tak, żeby dalej działał na tagu (WebGL).
15. **Testy** — przepisz asercje o strukturze Core3D (nie kasuj testów): `renderPerfGates` (cienie per światło, puste
    passy, `initTexture`, flagi `needsUpdate` uniformów z WebGL), `perfInstrumentation`, `sceneMatrixSync`,
    `ringPlanetAnchoring` (pass warstwy 6 w runnerze), `shipLights3D` (pass FG), `shadowShaftsQuality` (tylko asercje
    o łańcuchu passów / `WebGLRenderTarget` — resztę zostaw na 03), `warpLens3D` / `warpSpace` / `warpWorldLens`
    (asercje o passie soczewki w `core3d.js` znikają, matematyka CPU zostaje), `menuBackdrop` (`renderBackdrop` bez
    `_postPasses`), `glslReservedWords` (próg „> 50 shaderów” → sprawdzanie tylko, jeśli są), `fighterCombatFixes`.
16. **Znana regresja przejściowa (zapisz w `POSTEP.md`):** `readRenderTargetPixels` nie istnieje, więc mapa CPU ringu
    jest pusta do zadania 06 — płyta ringu dalej koliduje, ale bez rzeźby terenu (`HaloRingCollider`, `h = 0`).
17. **`src/3d/modelBaker.js` usuń** (decyzja użytkownika — narzędzie dev z własnym `WebGLRenderer`) razem z wywołaniem
    w `src/ui/devTools.js`; w kodzie gry nie zostaje żaden `WebGLRenderer` poza overlayem (do zadania 20).

## Pułapki
- `render()` przed `await renderer.init()` → ostrzeżenie three co klatkę (harness liczy je jako błąd): bramka `gpuReady`.
- `isInitialized` używają moduły do decyzji „zainicjuj/pomiń” — nie zmieniaj jego znaczenia (patrz krok 3).
- Kanwę czytaj/kopiuj w tym samym zadaniu co render (SPIKE 5). `alpha: true` → premultiplied.
- Nie dokładaj `outputColorTransform` (domyślnie `true` — podwójna transformacja; gra robi ACES i sRGB sama).
- `info.autoReset = true` zeruje liczniki w wewnętrznej pętli rAF renderera — musi być `false`.
- Harness działa w trybie „hold” (rAF strony tylko na żądanie) — pętla `Animation` renderera też przez niego idzie;
  nie uzależniaj niczego od `setAnimationLoop`.
- Zamiennik dziedziczy blending oryginału: addytywny pełnoekranowy `ShaderMaterial` (np. stary pass) zaleje ekran
  magentą — pełnoekranowe passy Core3D muszą być już przeniesione albo wyłączone.
- `overlay3D` / `rocketOverlay3D` zostają na własnym `WebGLRenderer` (osobne kanwy) — nie ruszaj. Efekty broni, iskry i
  rakiety zabierają z nich zadania 17–19 (nowe efekty z dem), overlay usuwa zadanie 20.
- Nie zmieniaj liczby ani kolejności `Math.random` w JS (determinizm scen dynamicznych względem bazy).
- CRLF: skrypty edycji zapisuj `Write`/`Edit`, nie heredokiem z `\\` (memory: ukośniki).

## Kryteria akceptacji
- Gra startuje na WebGPU (`Core3D.renderer.isWebGPURenderer && backend.isWebGPUBackend`), menu, gra, podzielony ekran
  działają; kopia do `#c` poprawna; brak nowych rendererów WebGL poza `overlay.js`.
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek względem listy w `POSTEP.md` (testy z kroku 15
  przepisane, każda zmiana opisana w commicie).
- Harness `--backend webgpu`: wszystkie 16 scen i 32 warianty przechodzą bez błędów walidacji WebGPU / WGSL i ostrzeżeń
  three; `kalibracja__ortho` (same materiały wbudowane) porównana z bazą — zanotuj liczby (bez bloomu różnica będzie
  duża; to punkt odniesienia dla 02); `spis.zamienniki` per scena zapisany w `POSTEP.md`.
- `Core3D.gpuFrameMs` > 0 w scenach; `window.__rendererInfo.calls` = draw calle; brak alokacji per klatka w nowym kodzie.
- `node scripts/webgpu/inwentarz.mjs` → `INWENTARZ.md` w commicie; `POSTEP.md` (tabela + dziennik); `agents.md`:
  zaktualizuj fakty o Core3D, które się zmieniły (renderer, cienie per światło, zegar GPU, brak splitu w jednym renderze,
  soczewka warpa usunięta); commit na `main`.

## Czego NIE robić
- Nie przywracaj `WebGLRenderer` ani GLSL w Core3D; nie dodawaj frameworków.
- Nie przenoś bloomu, gorącego powietrza (02), maski słońca / SDF / refrakcji (03), materiałów modułów (04+).
- Nie usuwaj API warpa ani testów — tylko to, co opisane.
- Nie zmieniaj rozgrywki ani HUD 2D.

## Raport na koniec
Co zrobione; zrzuty do obejrzenia: `.tmp/webgpu/zadania/01/webgpu/*.png` vs `.tmp/webgpu/baseline/webgl/p1/*.png`
(zestawienia `porownanie-z-baza/*-obok.png`); tabela `spis.zamienniki` per scena; czas startu gry (log harnessu);
znane regresje przejściowe; co zostało dla 02; pytania.
