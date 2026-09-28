# Zadanie 06 — Ring 1/5: biblioteka TSL ringu, pieczenie map, odczyt asynchroniczny, warsztat halo_ring_demo
Zależności: 01 | Równolegle z: 02–05, 12–20 | Zalecany effort: max
Zakres: `src/3d/haloRing/haloRingGLSL.js` (486 linii: `HALO_GLSL_COMMON`, `NOISE`, `STORM`, `LIGHT`, `AIR`,
`PORTSITES`, `TRANSIT`, `FG`, `FG_CLIP`, `RTE`), wspólne kawałki z innych plików ringu: `HALO_GLSL_SURFACE`,
`HALO_GLSL_CLOUDCOVER` (`haloRingTerrain.js:33, :92`), `src/3d/haloRing/haloRingUniforms.js`,
`src/3d/haloRing/haloRingWorldGen.js` (470: `WORLD_GLSL` 446 + 2 materiały pieczenia, `_readbackCpu`,
`createHaloBakeWarmup`), `src/3d/haloRing/haloRingDetail.js` (49, 1 materiał + cel), warsztat
`dema/halo_ring_demo.html` / `.js` / `halo_ring_demo_env.js`, `scripts/halo-ring-shots.mjs`. ~1100 linii GLSL.

## Cel
Fundament ringu na WebGPU: cała biblioteka GLSL ringu jako funkcje TSL (materiały ringu w 07–10 i tło menu w 11 tylko
jej używają), mapy świata pieczone w TSL, **odczyt CPU mapy wysokości asynchroniczny** i zgodny liczbowo z WebGL (mapa
steruje kolizjami płyty, LOD terenu, rozstawieniem budowli i wysokością kamery — gameplay), ring nie zgłasza gotowości
przed odczytem. Warsztat `halo_ring_demo` działa na `WebGPURenderer` (zamienniki tam, gdzie materiały czekają na 07–10).

## Przeczytaj najpierw
`agents.md` (Ring „Halo”: RTE, `haloRings.update` z kamerą TEJ klatki, ring = przeszkoda), `docs/PORT-halo-ring.md`
(API modułu, § „W grze”, Kolizje, Jakość i „Ultra”, narzędzie zrzutów), `docs/webgpu/PLAN.md` §3, §6,
`docs/webgpu/SPIKE.md` (6 — padding 256 B i odwrócona oś Y, 10 — kompilacja), `docs/webgpu/POSTEP.md`,
`src/3d/haloRing/haloRingWorldGen.js` w całości, `haloRingGLSL.js` w całości, `src/3d/haloRing/index.js`
(`terrainHeightAt`, `mapsReady`, `stats`), `src/game/haloRingCollision.js`, testy `haloRingProfiles`,
`haloRingRoofPlan`, `haloRingGame`, `haloRingLayout`.

## Kroki
1. **Biblioteka TSL** (`src/3d/haloRing/haloRingTSL.js`): każda funkcja GLSL biblioteki jako `Fn` z `setLayout`
   (typy wejść/wyjść jak w GLSL), plus `HALO_GLSL_SURFACE` i `HALO_GLSL_CLOUDCOVER` (używają ich teren, atmosfera,
   miasto, megastruktura, struktura). Hash/szum **bit w bit** jak GLSL tam, gdzie mają lustra CPU (`haloRingRoofPlan`:
   hash całkowity dachu) — test parzystości musi przejść. RTE (`uCamLocal`) bez zmian — ring nie potrzebuje
   `highPrecision`. Stare stałe GLSL usuń, gdy nic ich nie importuje (materiały 07–10 jeszcze importują — zostaw je do
   ich zadań albo przenieś import na TSL od razu; inwentarz pokaże stan).
2. **`haloRingUniforms.js`:** `createHaloUniforms()` → węzły TSL + `uniformsAdapter` (klucze bez zmian: test
   `haloRingProfiles` sprawdza parzystość kluczy i `uSkyTint.value`).
3. **Pieczenie (`haloRingWorldGen.js`):** materiały A/B/C na `QuadMesh`/`NodeMaterial`, cele `RenderTarget`, wycinki
   (`slices`, niska → pełna rozdzielczość), `setCivic` (ponowny bake), jakość „Ultra” 16K (limity z 01). Bez GLSL.
4. **Odczyt CPU asynchroniczny:** `_readbackCpu` → `await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h)`:
   usuń padding wierszy (`ceil(w·16/256)·256` B — przy w = 2048 brak, ale licz ogólnie) i **odwróć oś Y** (wiersz 0 =
   góra celu). `ring.mapsReady` / gotowość dla gry dopiero po zapisaniu `this.cpu`. Ring budowany leniwie
   (`HaloRingGame`, < 420 tys. j.) i w menu (`showcaseRing`) — sprawdź, że kolizje (`setTerrain`) nie widzą pustej mapy.
5. **Zgodność liczbowa mapy:** skrypt (np. `scripts/webgpu/ring-mapa.mjs`) zrzuca statystyki `cpu.heights` (min/max/
   średnia, histogram, hash zaokrąglonych wartości, kilka próbek) dla Ziemi, Marsa, Jowisza — na `main` (WebGPU) i w
   worktree z tagu `webgl-baseline` (WebGL, `README.md`). Różnice ≤ tolerancja float (zapisz ją) — to jest główne
   kryterium tego zadania (materiały ringu to jeszcze zamienniki).
6. **`haloRingDetail.js`:** tekstury detalu przez cel — TSL.
7. **Rozgrzewka:** `createHaloBakeWarmup` — na WebGPU klucz pipeline'u ≠ klucz programu WebGL; najprościej
   `compileAsync` na PRAWDZIWYCH obiektach pieczenia przed pierwszym bake'em (API funkcji dla `menuBackdrop3D`
   zachowaj albo zmień razem z wywołaniem; pełne przeprojektowanie tła menu — zadanie 11).
8. **Warsztat:** `dema/halo_ring_demo.*` — `WebGPURenderer` + `RenderPipeline` (bloom z `bloomConfig`, ACES gry z
   `src/3d/tsl/kolorGry.js`); `window.__halo` (`ready`, `renderFrames`, `stats`, `bench`, `measureHDR` → odczyt
   asynchroniczny) działa; `scripts/halo-ring-shots.mjs` bez `getContext('webgl2')` (nazwa GPU z adaptera WebGPU).

## Pułapki
- `fwidth`/`dFdx` w niejednorodnym przepływie: three wyłącza diagnostykę (USTALENIA §4) — kompiluje się, ale sprawdź obraz.
- Odczyt tworzy bufor mapowany na każde wywołanie — nie w pętli klatki.
- Mapę CPU czyta nie tylko kolizja: plan landmarków i kopuł (`haloCivicContext` w `src/3d/haloRing/index.js:76` —
  bez mapy stawia je na stałej wysokości), LOD terenu (`haloRingTerrain.js`, `heightAtUV`) i `terrainHeightAt`. Plan
  budowli musi poczekać na odczyt (potem `setCivic` i ponowny bake), inaczej rozstawienie różni się od bazy.
- Rozmiar mapy CPU: `2048 × max(32, round(96 · width / 6000))` — sprawdź dla każdego profilu (Ziemia / Mars / Jowisz).
- Ringi Marsa i Jowisza (`createArchRing`) mają `mapsReady = true` zawsze — sprawdź, czy korzystają z tej samej mapy CPU.
- Ring leży setki tysięcy j. od początku układu — RTE, nie `mesh.position` z bezwzględną pozycją w danych.
- Nie zmieniaj `Math.random` w JS generatora (rozstawienie budowli i landmarków musi zostać to samo).

## Kryteria akceptacji
- `npm test` (m.in. `haloPortTraffic`, `portParking`, `portPaths`, `ringRouter` — importują układ ringu) i
  `node --test "tests/*.test.mjs"` (`haloRingProfiles`, `haloRingRoofPlan`, `haloRingGame`, `haloRingLayout`):
  bez nowych porażek.
- Mapa CPU zgodna z WebGL dla trzech planet (krok 5, liczby w raporcie i `POSTEP.md`); kolizja z terenem wraca
  (test ręczny w harnessie: statek przy ringu, `HaloRingCollider` dostaje wysokości ≠ 0).
- Harness `--backend webgpu --out .tmp/webgpu/zadania/06 --baza .tmp/webgpu/baseline/webgl/p1`: zero błędów walidacji;
  sceny ringu wstają (`ringReady`) bez przekroczenia czasu; bez regresji poza ringiem.
- `halo_ring_demo` startuje na WebGPU bez błędów (`halo-ring-shots.mjs --only p1,p8,k7_docked_z035`).
- `INWENTARZ.md`, `POSTEP.md`, `agents.md` (ring: biblioteka TSL, odczyt asynchroniczny), commit na `main`.

## Czego NIE robić
- Nie przenoś materiałów terenu, struktury, atmosfery, miasta, K-7, archetypów (07–10) ani tła menu (11).
- Nie zmieniaj układu ringu, profili, generatora ani kolizji (gameplay).

## Raport na koniec
Co zrobione; porównanie map CPU (liczby); czasy pieczenia WebGPU vs baza (log harnessu / demo); zrzuty dema; co
zostało; pytania.
