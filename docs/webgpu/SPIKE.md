# Spike WebGPU — Faza 0 (2026-09-27)

Warsztat: `dema/webgpu-spike.html` + `dema/webgpu-spike.js` (gry nie dotyka). Uruchomienie na prawdziwym GPU:

```
node scripts/webgpu/spike.mjs --tryb oba            # Vite + statyczny serwer z import map
node scripts/webgpu/spike.mjs --tryb vite --q ciezkie=1 --etykieta ciezki   # + kompilacja 160 rozwiniętych szumów
node scripts/webgpu/spike.mjs --tryb vite --q ciezkie=1 --etykieta fxc "--chrome=--disable-dawn-features=use_dxc"
```

Wynik: `.tmp/webgpu/spike/wyniki*.json` + zrzut strony. Środowisko: RTX 5080 (sterownik 610.88), Chrome 153 headless,
Windows 11, three r183 (`POSTEP.md` § Środowisko). **Wszystkie punkty działają; blokad nie ma.** Oba tryby ładowania
(Vite i import map) dają te same wyniki.

## Tabela

| # | punkt | działa? | obejście / uwagi | pomiar |
|---|---|---|---|---|
| 1 | `three` + `three/webgpu` + `three/tsl` na jednej stronie | **tak** (Vite i import map) | Jeden rdzeń klas (`THREE.Mesh === webgpu.Mesh`). Vite łączy `three`, `three/webgpu`, `three/tsl`, `BloomNode` we wspólne chunki `.vite/deps`. Import map: wpisy `three/webgpu` → `build/three.webgpu.js`, `three/tsl` → `build/three.tsl.js` (oba importują `three.core.js`). W grze dodać `optimizeDeps.include` dla `three/webgpu`, `three/tsl` (bez tego pierwsze wykrycie w dev przeładowuje stronę) | — |
| 2 | `WebGPURenderer`, alfa premultiplied, `await init()`, `highPrecision` | **tak** | `alpha: true` → `alphaMode: 'premultiplied'`; piksel (0,4; 0,2; 0; 0,5) po `drawImage` = 205,102,0,127 (oczek. 204,102,0,128). **`requiredLimits` obowiązkowe** — domyślne urządzenie ma `maxTextureDimension2D` 8192 (planety 8K, mapy ringu 16K), 16 tekstur i 16 varyingów na etap; adapter daje 16384 / 48 / 28. `powerPreference` Chrome na Windows ignoruje (ostrzeżenie w konsoli) — wybór GPU robi system | init 494–520 ms |
| 3 | Adapter uniformów `material.uniforms.X.value` | **tak** | `uniform()` ma `.value` (liczba, `Vector2.set` w miejscu) — działa bez zmian kodu aktualizacji; tekstura: `texture(t).value = inna` — działa. **`uniformArray`: `node.value` to spakowany `Float32Array`**, a `Vector4` gry siedzą w `node.array` → adapter musi wystawiać `{ get value() { return node.array } }`. Pipeline'y i programy bez zmian (2→2), `material.version` bez zmian | render + odczyt po zmianie 2,5–5 ms (w tym odczyt) |
| 4a | `RenderPipeline`: 3× `pass()` z `setLayers`, HalfFloat, MSAA 4, `BloomNode`, własny pass TSL, `outputColorTransform = false` | **tak** | Tło (0,05; 0,05; 0,1) → 59,59,99 = CPU (ACES gry + sRGB) — bez podwójnej transformacji. **Ale** każdy `pass()` ma własny cel: blending addytywny liczy się na przezroczystym celu, nie na tle, a pass nie widzi głębi poprzedniego (tarcze w Core3D testują głębię z passa ortho) → do scen Core3D nie pasuje 1:1 (patrz 4b) | CPU 0,07 ms/kl. |
| 4b | Model Core3D: kilka `render()` do jednego celu MSAA HalfFloat, czyszczenie tylko głębi, potem `RenderPipeline` z `texture(rt.texture)` | **tak** | Addytywny kwad na tle = 0,35; 0,35; 0,40 (dokładnie). Backend WebGPU trzyma MSAA między `render()` (`storeOp: store`, resolve na końcu każdego passa) — **nie ma inwalidacji z WebGL**, więc obejście `FullScreenBlendPass` (quad zamiast `ShaderPass` w środku łańcucha) przestaje być potrzebne. Rekomendacja: sceny ręcznie jak dziś, post (bloom, uber) jako węzły TSL w `RenderPipeline` | CPU 0,25–0,32 ms/kl. (3 passy + post), GPU 0,02 ms |
| 5 | Składanie: render → `ctx2d.drawImage(kanwa WebGPU)` w tym samym zadaniu; 2× na zadanie; `CanvasTarget` | **tak** | (a) 255,0,0,255; (b) split: lewa 255,0,0 / prawa 0,255,0 — dwa rendery w jednym zadaniu, dwie kopie działają; (c) **`CanvasTarget` + `renderer.setCanvasTarget()`**: ten sam renderer rysuje do drugiej kanwy (0,0,255) i wraca do głównej (255,0,0) → `overlay3D` / `rocketOverlay3D` (dziś osobne `WebGLRenderer`) mogą przejść na renderer Core3D bez zmiany składania. **Odczyt kanwy po `await` (następne zadanie) raz dał zera** — kopiować zawsze w zadaniu renderu (tak robi `drawHexShips3D`) | — |
| 5k | Koszt składania 1920×1080 | **tak** | kopia (render + `clearRect` + `drawImage`, dzisiejsza gra) vs warstwa (kanwa 3D pod przezroczystą 2D). Różnica znikoma — zostajemy przy kopii (zero zmian w tym, co widzi gracz); warstwa jako opcja w zadaniu wydajności | WebGPU kopia: klatka 0,27–0,32 ms, `drawImage` 0,02 ms; warstwa: 0,25–0,28 ms; WebGL kopia: 0,14–0,16 ms, `drawImage` 0,02 ms (scena prosta, bez vsync) |
| 6 | `readRenderTargetPixelsAsync` z RGBA32F (wysokości ringu) | **tak** | Wartości dokładne (10,5; 5,5; −4,423; −1,5). **Wiersze wyrównane do 256 B, wynik NIE jest przycinany** (50×20 → 5064 floatów zamiast 4000). **Wiersz 0 = GÓRA celu** (WebGL `readPixels`: dół) — kod CPU ringu (`haloRingWorldGen._readbackCpu` → `cpu.heights`) musi odwrócić oś albo shader pieczenia. Każdy odczyt tworzy nowy bufor mapowany (bez puli) | 2048×96 RGBA32F (3 MB, wymiar ringu): 4–4,5 ms; pierwszy odczyt w sesji 25–62 ms (czeka na kolejkę) |
| 7 | Render do warstwy `RenderTarget3D` i celu z `depth` > 1 | **tak** | `setRenderTarget(rt, warstwa)` dla obu; próbkowanie `texture3D(…)` i `texture(…).depth(warstwa)` daje 0; 0,25; 0,5; 0,75; odczyt warstwy tablicy wprost: `readRenderTargetPixelsAsync(rt, …, 0, warstwa)` | — |
| 8 | Znaczniki czasu GPU | **tak** | `trackTimestamp: true` + `await renderer.resolveTimestampsAsync('render')` = ms ostatnich renderów (zapytania się kumulują — rozwiązywać co klatkę; pula 2048). `info.render.timestamp` też | 1 prosty render: 0,004 ms |
| 9 | Cień `DirectionalLight`: `shadow.autoUpdate = false`, `shadow.needsUpdate = true` przed `render()` | **tak, z zastrzeżeniami** | Cień zostaje, gdy rzucający się rusza bez `needsUpdate`; przechodzi po `needsUpdate` (flaga kasuje się sama). Zastrzeżenia (źródło `ShadowNode.updateBefore`): (1) **aktualizacja najwyżej RAZ na klatkę rAF** — bramka `frameId` z wewnętrznej pętli `Animation` renderera, a `_cameraFrameId[camera]` na `WeakMap` przez `[]` daje jeden slot na wszystkie kamery; flaga czeka do pierwszego renderu z odbiorcą cienia w następnej klatce; (2) pierwsza aktualizacja mapy trwa DWA rendery (tworzenie tekstury głębi zmienia wersję). Dla gry wystarczy `sun.shadow.needsUpdate = true` raz na klatkę na starcie `Core3D.render`. Warstwy: kamera cienia z samą warstwą 0 bierze maskę kamery renderu; gra ustawia słońcu `shadow.camera.layers.enableAll()` (`planet3d.assets.js:1011`) — jak w WebGL | ślad: `[f448 nu 1→1 v →2] [f449 nu 1→0] [f450 nu 1→0] [f454 nu 0→0] [f455 nu 1→0]` |
| 10 | Koszt kompilacji — ten sam szum 3D w TSL/WGSL (WebGPU) i GLSL (WebGL, ANGLE D3D11) | **tak — WebGPU szybciej** | Chrome 153 kompiluje WGSL przez **DXC** (domyślnie); FXC (`--disable-dawn-features=use_dxc`) 2–4× wolniej. `compileAsync` = `createRenderPipelineAsync` (wątek główny wolny). Bez niej `render()` nowego materiału oddaje CPU po ~6 ms, ale **kolejka GPU czeka na kompilację** (przestój klatki). **Unikać rozwijania ciężkich funkcji pętlą JS**: `mx_noise_float` ×20 = 1,5 s, ×160 = 44 s — w TSL `Loop` zamiast `for` w JS | rozwinięty 20: WebGPU 93 ms / WebGL 260 ms; 40: 176 / 725 ms; pętla 160: 27 / 176 ms; **160 rozwiniętych: 1,1–2,0 s / 9,8–10,5 s**; FXC: 386 / 709 / 60 / 3229 ms |
| 11 | Precyzja przy 7,08 mln j. (kamera co 0,137 j., zoom 1,8) — drżenie środka plamki, px RMS / max | **tak** | `highPrecision = true`: `Mesh` 0,001 / 0,003; **`InstancedMesh` z dużym offsetem w `mesh.position` i instancjami względem niego 0,001 / 0,003** (mimo notki three „not compatible with InstancedMesh” — liczy się `modelViewMatrix` na CPU, instancja jest mała). Bez HP: 0,47 / 0,83 w obu. Instancje z BEZWZGLĘDNĄ pozycją świata: 0,47 / 0,83 także z HP → **reguła z `agents.md` (§ Moduły 3D, `sceneOrigin.js`) obowiązuje bez zmian**. HP wchodzi w program przy budowie materiału (przełączenie w biegu nie działa na zbudowane) | — |
| 12 | `overrideMaterial` z `colorWrite = false` (pre-pass głębi halo) + warstwy kamery | **tak** | Halo zasłonięte w tarczy (0,0,0), poza nią 0,0,1 | — |
| 13 | Viewport / nożyczki na celu, `clear()` przy nożyczkach | **uwaga** | **`clear()` czyści CAŁY cel** (`loadOp: clear`), nożyczek nie respektuje. Viewport celu = `rt.viewport` / `rt.scissor` / `rt.scissorTest` (`renderer.setViewport` działa tylko na kanwę). Ścieżka „split w jednym renderze” (`makeSplitScreenRenderPass`, `renderSplitScreen`, `_renderDirect`) jest w grze martwa — gra robi split jako 2× `renderSingle` + wycinek (`drawHexShips3D`); port ją usuwa | — |
| 14 | `renderer.info` przy `autoReset = false` | **tak** | Draw calle = `info.render.drawCalls` (w WebGL `render.calls`); `render.calls` liczy wywołania `render()` i `reset()` go NIE zeruje. Przy `autoReset = true` wewnętrzna pętla `Animation` zeruje liczniki na starcie każdej klatki rAF (Core3D ma `false` i zeruje ręcznie) | 8 draw calli / 16 trójkątów zgodnie z oczekiwaniem |
| 15 | Nieprzeniesiony `ShaderMaterial` na WebGPU | **tak (zamiennik)** | Bez niczego three loguje błąd „NodeMaterial: Material "ShaderMaterial" is not compatible” i rysuje pusty `NodeMaterial`. `renderer.library.addMaterial(Zamiennik, 'ShaderMaterial')` (i `'RawShaderMaterial'`) → magenta; stan renderu (blending, głębia, przezroczystość) kopiuje się z materiału; licznik budów = spis nieprzeniesionych w biegu. Wierzchołki idą domyślną ścieżką (billboardy, RTE ringu — w złych miejscach; to tylko zamiennik) | — |
| 16 | Blending One/One (addytywny HDR) i `depthFunc = GreaterDepth` (cień mostka pod kadłubem) | **tak** | Kwad z GREATER przechodzi tylko tam, gdzie kadłub zapisał głębię; addytywny dodaje dokładnie | — |
| 17 | MSAA w locie (`setMsaaEnabled`): `rt.samples = n` + `rt.dispose()` | **tak** | 0 → 4 → 0 bez błędów | — |

## Wnioski do planu

1. **Brak blokad.** Punkty 1, 2 i 5 działają bez obejść.
2. **Model klatki Core3D zostaje** (4b): sceny rysowane ręcznie po warstwach do jednego celu MSAA HalfFloat, post
   (resolve → bloom → uber: gorące powietrze, ACES gry, sRGB) jako węzły TSL w `RenderPipeline` z
   `outputColorTransform = false`. `pass()` na warstwę (4a) zmieniłby blending i test głębi tarcz.
3. **Składanie bez zmian** (5, 5k): kopia do `#c` w zadaniu renderu, split 2× `renderSingle`. `overlay3D` i rakiety
   mogą przejść na renderer Core3D przez `CanvasTarget` (zasada „jeden renderer”). Po decyzji o nowych efektach broni
   i rakiet (PLAN §1 p. 6) overlay znika w ogóle (zadanie 20) — `CanvasTarget` zostaje sprawdzoną możliwością.
4. **Precyzja** (11): `renderer.highPrecision = true` + dotychczasowa reguła „duży offset w `mesh.position`, dane
   względem niego” wystarczają — także dla `InstancedMesh`.
5. **Kompilacja nie jest ryzykiem** (10): WGSL/DXC kompiluje się 2–9× szybciej niż ten sam GLSL przez ANGLE.
   Zasady: `Loop` zamiast rozwijania w JS, `compileAsync` przy starcie (menu, pieczenie ringu), ciężkie funkcje
   z `Fn(...).setLayout(...)` (jedna funkcja WGSL zamiast wklejania).
6. **Odczyty** (6): asynchroniczne, padding 256 B, oś Y odwrócona względem WebGL — kod CPU ringu do poprawki.
7. **Cienie** (9): jedna aktualizacja mapy na klatkę — `needsUpdate` raz na starcie `render()`; dwa odświeżenia
   na klatkę z WebGL (ortho + FG) zbędne.
8. **Zamienniki** (15): `library.addMaterial` → magenta dla nieprzeniesionych `ShaderMaterial`; gra startuje na
   WebGPU od pierwszego zadania.
9. **Limity** (2): `requiredLimits` z adaptera w `Core3D`.
10. **`renderer.info`** (14): draw calle z `drawCalls`; PerfHUD i harness do przestawienia.
