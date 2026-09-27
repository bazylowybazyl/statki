# Zadanie 17 — Overlay efektów na renderer Core3D (CanvasTarget), iskry trafień, rakiety
Zależności: 03 | Równolegle z: 04–16 | Zalecany effort: max
Zakres: `src/effects3d/overlay.js` (DRUGI `WebGLRenderer` + `EffectComposer` / `RenderPass` / `UnrealBloomPass` /
`ShaderPass`, `RestoreAlphaShader` 36 linii, warstwa raw rakiet, `prewarm`, jakość adaptacyjna, modyfikatory bloomu),
`src/3d/sparkSystem3D.js` (1 materiał / 112 linii — iskry trafień i tarcia, scena overlay), rakiety:
`src/effects3d/rocketFireGPU.js` (1 / 213), `src/effects3d/rocketSmokeGPU.js` (1 / 74), `src/effects3d/rocketSystem3D.js`
(wbudowany, zakresy uploadu), wpięcie w `index.html` (`startOverlay3D`, `DevFlags.splitOverlayContexts`).
4 materiały / 435 linii + drugi renderer.

## Cel
W grze zostaje jeden renderer: overlay efektów i rakiet rysuje `Core3D.renderer` do WŁASNEJ kanwy przez `CanvasTarget`
(SPIKE 5), składanie `mix-blend-mode: screen` bez zmian, bloom overlaya = osobny `RenderPipeline` z `BloomNode`
(parametry `overlay*` z `bloomConfig.js` + modyfikatory efektów), alfa i barwy jak dziś. Iskry i rakiety w TSL.
Wybuchy na `ShaderMaterial` (reaktor, Yamato, Supernowa) są do zadania 18 zamiennikami; trafienia na materiałach
wbudowanych (railgun, armata, działko) działają od razu.

## Przeczytaj najpierw
`agents.md` (Core3D: bloom, `UnrealBloomPass` ~9 × strength; Nośnik — iskry i `followCarrier`; Pociski — iskry tarcia
`COLLISION_SPARKS_TUNE`, `gain`), `docs/webgpu/PLAN.md` §2 (overlay, składanie), §3, §6 (rozgrzewka, trzymacze), §9
(„Scena overlay”), `docs/webgpu/SPIKE.md` (5 — `CanvasTarget`), `docs/webgpu/POSTEP.md` (decyzja o nowych efektach
rakiet — PLAN §12 p. 6), `src/effects3d/overlay.js` w całości, `index.html` (grep: `startOverlay3D`,
`resizeOverlay3D`, `overlay3D.tick`), pliki zakresu, testy: `overlayContextMerge`, `shaderPrewarm`, `renderBugfixGuards`
(bloom overlaya, cząstki rakiet, haze rakiet), `renderPerfGates`, `collisionSparks`, `collisionFx`, `rocketGuidance`.

## Kroki
1. **Renderer:** `initOverlay` bierze `Core3D.renderer` (po `Core3D.ready`) i tworzy `CanvasTarget` na własnej kanwie
   (klasa `overlay3d`, styl, `zIndex`, host `#game-root` jak dziś; DPR ≤ 1,2). Render overlaya:
   `renderer.setCanvasTarget(ov)` → pipeline → warstwa raw → przywrócenie głównego celu (zawsze, `try/finally`).
   Wołany w tym samym miejscu klatki co dziś (`tick`), po `Core3D.render`, nigdy w środku passów Core3D.
2. **Pipeline overlaya:** scena → cel HalfFloat (rozmiar × `renderScale`, jakość adaptacyjna zmienia rozmiar celu, nie
   kanwy) → `BloomNode` (siła / promień / próg z `getOverlayBloomConfig` + `bloomModifiers`: max dodatków, min progu,
   sufit siły — co klatkę jak dziś) → „przywrócenie alfy” w TSL 1:1 z `RestoreAlphaShader`: alfa `min(1, max(rgb) · 1,5)`
   z SUROWEGO HDR, kolor = sRGB(ACES overlaya: ekspozycja × 1,2, clamp) — to INNA krzywa niż ACES gry.
3. **Alfa kanwy:** kanwa WebGPU ma tylko `alphaMode` `'premultiplied'` albo `'opaque'`; overlay WebGL miał
   `premultipliedAlpha: false`. Wyjście `vec4(kolor · alfa, alfa)` daje po składaniu `screen` ten sam obraz — sprawdź
   zrzutem (scena z iskrami / trafieniami obok bazy).
4. **Warstwa raw (rakiety):** bez bloomu i alfy, na tę samą kanwę po skomponowanym overlayu (dziś: druga scena w tym
   samym kontekście). `DevFlags.splitOverlayContexts` przy jednym rendererze traci sens — usuń gałąź albo zrób drugą
   kanwę `CanvasTarget` (opisz wybór).
5. **`SparkSystem3D`** → TSL: tor analityczny, `iGain`, początek „lepki” przy kamerze (`sceneOriginNearCamera`); API JS
   bez zmian (`collisionSparks`, `collisionFx`).
6. **Rakiety:** `rocketFireGPU`, `rocketSmokeGPU` → TSL (pule cząstek, zakresy uploadu kumulowane — test
   „cząstki rakiet…”), `rocketSystem3D` (wbudowany; nośnik wyrzutni — `rocketGuidance`; haze `pushHeatHazeWorld(burst.x,
   -burst.z, -4, …)` — test).
7. **Rozgrzewka:** `prewarm` overlaya na PRAWDZIWYM celu overlaya i kamerze overlaya (PLAN §6); trzymacze próbek fabryk
   (rail, armata, działko) zostają — odpowiednik testu `shaderPrewarm`.
8. **Liczniki:** `info.autoReset = false` — draw calle overlaya doliczą się do Core3D; PerfHUD („Overlay FX 3D”) i
   `window.__rendererInfo` mają je rozróżniać (odczyt przed / po renderze overlaya).
9. **Harness:** overlay rysuje teraz renderer Core3D — dopisz go do `spis` (sceny efektów i raw jako „overlay”) i
   sprawdź, że `isolate` (warianty warstw) go nie filtruje (kamera overlaya ≠ kamery Core3D) — jak w bazie, gdzie był
   osobnym rendererem. Jeśli żadna scena bazy nie pokazuje rakiet (obejrzyj `bitwa*`), dopisz scenę `rakiety`
   (`import('/src/effects3d/rocketSystem3D.js')` → `fireRocket3D` w pirata) i jej bazę z tagu (`README.md`).

## Pułapki
- Kanwę overlaya składa przeglądarka — niczego nie kopiujemy (inaczej niż `#webgl-layer` → `#c`).
- Pusty overlay: dziś `renderer.clear()` kanwy przy braku efektów; w WebGPU wyczyść kanwę raz przy przejściu w stan
  pusty, nie co klatkę (bez passów na pusto — `flushParticlePools`, `sceneHasVisibleContent`).
- Zamienniki wybuchów (do 18) są addytywne — w scenie `wybuch` magenta może zalać kadr; zapisz liczby, nie obchodź.
- `setSize` kanwy przy `resizeOverlay3D` — `CanvasTarget.setSize` / piksele, nie `renderer.setSize` (to główna kanwa).

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek (`overlayContextMerge`, `shaderPrewarm` przepisane).
- `grep "new THREE.WebGLRenderer\|new WebGLRenderer"` w `index.html` i `src/` — zero w plikach gry (wyjątek do
  decyzji: `src/3d/modelBaker.js`, PLAN §12 p. 3).
- Harness `--backend webgpu --out .tmp/webgpu/zadania/17 --baza .tmp/webgpu/baseline/webgl/p1`: zero błędów walidacji;
  iskry i rakiety bez zamienników, sceny bitwy w tolerancji (poza wybuchami z 18); PerfHUD „Overlay FX 3D” ~ baza.
- `INWENTARZ.md`: `overlay.js` bez drugiego renderera i GLSL, pliki zadania bez GLSL; `POSTEP.md`; `agents.md` (overlay
  na rendererze Core3D, `CanvasTarget`); commit na `main`.

## Czego NIE robić
- Nie przenoś wybuchów reaktora, Yamato, Supernowej (18); nie zmieniaj parametrów bloomu ani krzywej overlaya.
- Nie wprowadzaj efektów z `dema/rakiety-webgpu` bez decyzji użytkownika (PLAN §12 p. 6).

## Raport na koniec
Co zrobione; zrzuty iskier/rakiet obok bazy; ms overlaya przed/po; decyzja o `splitOverlayContexts`; co zostało; pytania.
