# Port renderu 3D na WebGPU — ustalenia wstępne (2026-09-27)

> Fakty sprawdzone w kodzie na commicie `2c2ef18` i w źródłach three r183
> (`node_modules/three`). Nie odkrywaj ich od nowa — zweryfikuj tylko to,
> na czym opierasz decyzję. Numery linii mogą się przesunąć; szukaj grepem.

## 1. Skala portu

| Co | Ile | Gdzie |
|---|---|---|
| Własne `ShaderMaterial` / `RawShaderMaterial` | ~105 w 53 plikach | `src/3d/**`, `src/effects3d/*`, `src/vfx/*` |
| GLSL w literałach szablonowych | ~12,7 tys. linii w 59 plikach (heurystyka; wlicza legacy `planet3d.proc.js`, 392 linie) | największe: `rocks/rockMaterial3D.js` 615, `haloRing/haloRingTerrain.js` 601, `haloRingStructure.js` 564, `haloRingMegastructure.js` 535, `haloRingGLSL.js` 497, `haloRingWorldGen.js` 467, `hexShips3D.js` 445, `shield3D.js` 431, `bridge3D.js` 420, `cargoContainers3D.js` 419 |
| Ring „Halo” | 18 `ShaderMaterial` + biblioteka `haloRingGLSL.js`, ~3,4 tys. linii GLSL (~27% całości) | `src/3d/haloRing/` |
| `onBeforeCompile` | 1 miejsce (maska cienia słońca na wbudowanych materiałach three) | `src/3d/sunShadowMask.js:116` (`applySunShadowToBuiltinMaterial`) |
| Testy zależne od tekstu GLSL / WebGL | 12 | `tests/`: cargoContainers3D, glslReservedWords, haloRingRoofPlan, hullShadowSdf, menuBackdrop, overlayContextMerge, shadowShaftsQuality, shipLightRuntime, shipLights3D, shipProxyBatch3D, warpLens3D, warpSpace |
| Instancing | ~184 użycia `InstancedMesh` / `InstancedBufferAttribute` | cała warstwa 3D |
| Materiały przebudowywane w locie | 5× `material.clone()`, 32× `material.needsUpdate = true`, 13× `defines` | w WebGPU każda nowa kombinacja = nowy pipeline (kompilacja) |

Testy: `npm test` uruchamia tylko `scripts/tests` (32 zestawy). Katalog `tests/`
(183 z 185 plików na `node:test`) idzie osobno: `node --test tests/`.

## 2. Rdzeń renderu dziś (`src/3d/core3d.js`, 2422 linie)

- Renderer: `core3d.js:777` — `WebGLRenderer({ alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: 'high-performance' })`, `outputColorSpace = LinearSRGBColorSpace`, `toneMapping = NoToneMapping` (tone mapping ACES jest w passie „uber”), `renderer.info.autoReset = false` (reset ręczny raz na klatkę), `scene.matrixWorldAutoUpdate = false` (macierze aktualizowane ręcznie raz na klatkę).
- Cienie: `core3d.js:786-794` — `shadowMap.autoUpdate = false`, odświeżanie ręczne (`needsUpdate = true`) tylko przed passami ortho i FG (`core3d.js:1637`, `:1688`).
- Łańcuch (`core3d.js:911-989`): `RenderPass` ×7 (Bg, WarpStars, Planets, RingPlanets, Ortho, Shields, Fg), własne `FullScreenBlendPass` (halo planet, shadow shafts → maska `sunShadowTarget`, soczewka warp, scene resolve), `UnrealBloomPass`, `ShaderPass` „uber” (heat haze do 24 źródeł, fale warpa, ACES), pre-pass halo, snapshot refrakcji w połowie rozdzielczości. Do ~11 `renderer.render(scene, …)` na klatkę.
- Cele renderu: HalfFloat + MSAA 4 (scena, `planetHaloTarget`), `postTarget`, `sunShadowTarget`, `refractionTarget`, leniwe `warpLensTarget` / `warpStarTarget`. `setMsaaEnabled` zmienia `samples` w locie.
- Warstwy: 0 ortho (gra), 1 tło, 2 FG, 3 planety, 5 halo, 6 ring-planety, 7 tarcze, 8 gwiazdy warpa, 9 tło menu (`MENU_BACKDROP_LAYER`, rysuje tylko `renderBackdrop`).
- Pomiar GPU: `EXT_disjoint_timer_query_webgl2` (`core3d.js:1281-1334`) → `Core3D.gpuFrameMs` → PerfHUD (`src/ui/perfHud.js:1546`).
- Kompozycja klatki: `#webgl-layer` (z-index 0) leży POD `#c` (canvas 2D, z-index 1) — `index.html:439-442`, a mimo to co klatkę `drawHexShips3D` czyści `#c` i kopiuje klatkę 3D przez `ctx.drawImage(Core3D.canvas)` (`src/3d/hexShips3D.js:2600`). Split-screen renderuje dwa razy (`renderSingle` ×2) i kopiuje wycinki.
- Import map: `index.html:688-689` (`three` → `build/three.module.js`, `three/addons/` → `examples/jsm/`).

## 3. Miejsca zależne od WebGL (poza shaderami)

| API | Miejsca | W WebGPU |
|---|---|---|
| `renderer.compile(...)` synchronicznie | `shield3D.js:1159`, `hexShips3D.js:2255`, `weapon3DSystem.js:849` | `compile` to alias `compileAsync` (`three/src/renderers/common/Renderer.js:3459`) |
| `renderer.compileAsync` + rozgrzewka po kluczu programu WebGL (liczba świateł w kluczu) | `menuBackdrop3D.js:345, 371`, `haloRingWorldGen.js` (`createHaloBakeWarmup`), test `tests/menuBackdrop.test.mjs` | pipeline'y WebGPU mają inny klucz — rozgrzewkę trzeba zaprojektować od nowa |
| `readRenderTargetPixels` (synchronicznie) | `haloRingWorldGen.js:726` (wysokości ringu → LOD terenu `haloRingTerrain.js:799`, rozstawianie budowli i kopuł `haloRing/index.js:77`, wysokość kamery `index.js:353`), `rocks/rockShapes3D.js:850` | tylko `readRenderTargetPixelsAsync` (`Renderer.js:2884`) → budowa ringu i skał staje się asynchroniczna |
| `initRenderTarget` | `rockShapes3D.js:752-753`, `rockMaterial3D.js:221` | istnieje, wymaga `await renderer.init()` |
| `WebGLArrayRenderTarget` | `rockShapes3D.js:668, 688` | `RenderTarget` z opcją `depth` (sprawdź) |
| `WebGL3DRenderTarget` | `rocks/giantRock3D.js:367`, `rockMaterial3D.js:192` | `RenderTarget3D` (`three/src/core/RenderTarget3D.js`) |
| `EffectComposer`, `RenderPass`, `ShaderPass`, `UnrealBloomPass`, `Pass`/`FullScreenQuad` z `three/addons/postprocessing` | `core3d.js` | tylko WebGL → `RenderPipeline` + węzły TSL (`pass()`, `BloomNode`) |
| `onBeforeCompile` | `sunShadowMask.js:116` | brak — węzły `NodeMaterial` (`colorNode`, `outputNode`, …) |
| GPU timer `EXT_disjoint_timer_query_webgl2` | `core3d.js:1281-1334` | `trackTimestamp: true` (wymaga cechy `timestamp-query`) + `renderer.resolveTimestampsAsync()` |

## 4. three r183 pod WebGPU — sprawdzone w źródłach

- `three` i `three/webgpu` importują ten sam `build/three.core.js` → obie paczki mogą żyć na jednej stronie bez podwójnych klas rdzenia. `three/tsl` (`build/three.tsl.js`) importuje `three/webgpu`, więc import map potrzebuje wpisów `three/webgpu` i `three/tsl`. Pod Vite (pre-bundling) sprawdź, że rdzeń jest jeden (`THREE.Mesh === (await import('three/webgpu')).Mesh`).
- `WebGPURenderer` nie obsługuje `ShaderMaterial`: `src/renderers/webgpu/nodes/StandardNodeLibrary.js:65-77` mapuje tylko materiały wbudowane (MeshBasic/Standard/Physical/Phong/Lambert/Toon/Normal/Matcap, Line*, Points, Sprite, Shadow).
- `PostProcessing` w r183 zmienił nazwę na **`RenderPipeline`** (stara nazwa deprecated). `RenderPipeline.outputColorTransform = true` domyślnie (`RenderPipeline.js:66`) — gra robi własny tone mapping i wyjście liniowe, więc pilnuj, żeby nie było podwójnej transformacji.
- **Precyzja:** w TSL `modelViewMatrix` domyślnie = `cameraViewMatrix * modelWorldMatrix` liczone na GPU we float32 (`src/nodes/accessors/ModelNode.js:124-138`, `mediumpModelViewMatrix`). WebGLRenderer składa ją na CPU w double — na tym stoją reguły precyzji z `agents.md` (świat przy 5–10 mln j., `Bridge3D._setOrigin`). W WebGPU trzeba `renderer.highPrecision = true` (`Renderer.js:1062`). Ring liczy pozycje względem kamery sam (`haloRing/haloRingGLSL.js:400-405`, `uCamLocal`) — tej flagi nie potrzebuje, reszta gry tak.
- Cienie: `renderer.shadowMap` w WebGPU ma tylko `enabled / transmitted / type` (`Renderer.js:684`); odświeżanie jest per światło: `light.shadow.autoUpdate` / `light.shadow.needsUpdate` (`src/nodes/lighting/ShadowNode.js:813`).
- WGSL zabrania pochodnych (`fwidth`, `dFdx`) w niejednorodnym przepływie sterowania, ale three wyłącza tę diagnostykę (`src/renderers/webgpu/nodes/WGSLNodeBuilder.js:169`) — `fwidth` wewnątrz `if` (ring, K-7) nie blokuje kompilacji.
- Tablice uniformów: `uniformArray` (`src/nodes/accessors/UniformArrayNode.js:350`).
- `renderer.info.autoReset` istnieje (`src/renderers/common/Info.js:24`).
- Efekty dostępne tylko w TSL (`examples/jsm/tsl/display/`): m.in. `BloomNode`, `GTAONode`, `SSRNode`, `SSGINode`, `TRAANode`, `GodraysNode`, `AnamorphicNode`, `MotionBlur`, `LensflareNode`, `DenoiseNode`; oświetlenie kafelkowe `examples/jsm/lighting/TiledLighting.js`. Port ich NIE dodaje — to materiał na później.

## 5. Co już jest w repo i pomoże

- **Narzędzia CDP bez zależności:** `dema/rdzen-cdp.js` (Vite + headless Chrome z `C:/Program Files/...`, flagi `--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist --enable-unsafe-webgpu`, zbieranie konsoli i wyjątków), `scripts/dym-gry-belki.mjs` (steruje PRAWDZIWĄ grą: `?dev`, menu → single, scenariusze taran / bitwa, zrzuty, błędy konsoli), `scripts/halo-ring-shots.mjs` (zrzuty ringu + draw calle, trójkąty, ms/klatkę, histogram HDR, błędy shaderów), `dema/rdzen-shots.js`, `scripts/proxy-batch/*`, `dema/precyzja-drzenie.js` (pomiar drżenia 3D względem kadłuba przy 5–10 mln j.). Wyniki idą do `.tmp/` (w `.gitignore`).
- **Istniejący kod WebGPU:** solver sprężyn `src/game/destructorGpuSoftBody.js` i `destructorGpuSoftBody3D.js` ma własne `GPUDevice` i asynchroniczny odczyt (`mapAsync`). Zostaje, jak jest — dwa urządzenia (renderer + solver) mogą działać obok siebie.
- **Lustra CPU shaderów:** `traceHullShadowCpu` (`hullShadowSdf.js`, test `tests/hullShadowSdf.test.mjs`), `dema/rdzen-softbody-cpu.js`. Wersja TSL musi zgadzać się z lustrem tak jak GLSL.
- **Electron 33** (Chromium 130), strona z własnego schematu `app://` oznaczonego jako `secure` (`electron/main.js`) — kontekst bezpieczny, WebGPU powinno działać; produkcyjny build to `vite build` → `dist/`.

## 6. Kontekst wydajności

`docs/AUDYT-wydajnosc-bitwa-2026-09-24.md`: w dużej bitwie klatka 25,9 ms, z czego fizyka 16,1 ms; rysowanie 7,3 ms to głównie CPU (`U hex` 2,61 ms JS, `Core render` 2,35 ms CPU przy ~11 przejściach sceny). Sam port na WebGPU nie przyspieszy klatki ograniczonej przez CPU — mierz i raportuj, nie obiecuj.

## 7. Środowisko weryfikacji

WebGPU trzeba sprawdzać na prawdziwym GPU (lokalnie, Windows). W kontenerze chmurowym Claude Code WebGPU nie nadaje się do weryfikacji: SwiftShader daje adapter tylko z flagami (`--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`), a urządzenie ginie po pierwszym `submit`. Test kopiowania canvasa WebGPU na canvas 2D był tam przez to niekonkluzywny — do sprawdzenia lokalnie.
