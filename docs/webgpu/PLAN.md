# Port renderu 3D na WebGPU — plan

> Faza 0 (2026-09-27). Decyzje oparte na spike'u na prawdziwym GPU (`SPIKE.md`), inwentarzu
> (`INWENTARZ.md`, `node scripts/webgpu/inwentarz.mjs`) i bazie odniesienia (`baseline.json`, tag `webgl-baseline`).
> Stan zadań i dziennik: `POSTEP.md`. Fakty sprawdzone wcześniej: `USTALENIA.md`. Jak odpalać zadania: `README.md`.

## 1. Zasady portu (decyzje użytkownika 2026-09-27)

1. **Jedna ścieżka renderu: `WebGPURenderer` + TSL.** Od zadania 01 `Core3D` tworzy wyłącznie `WebGPURenderer`.
   Starego `WebGLRenderer` nie ma w kodzie — jest tylko w tagu `webgl-baseline`.
2. **GLSL usuwamy.** Zadanie, które przenosi moduł, usuwa jego GLSL w tym samym commicie. Nowego GLSL nie piszemy
   (`agents.md` § Port WebGPU).
3. **Praca na `main`** (użytkownik ma kopię zapasową). Zadania równoległe — w worktree, potem merge do `main`.
4. **Gameplay bez zmian.** Port dotyka tylko warstwy renderu 3D. Wyjątki to decyzje użytkownika: **stare pole
   asteroid i tło pasa są wyłączone na czas portu** (`OLD_ASTEROIDS_ENABLED`, `?asteroidyStare` przywraca je na tagu)
   oraz **mechanika broni z dema** (przebicia, rykoszety, ładowanie Mjolnira, serie Hexlance'a — zadanie 18).
5. **Poza portem 1:1:** stara soczewka warpa (usuwana w 01) i stare asteroidy (wyłączone) — zamiast nich wchodzą NOWE
   z dem WebGPU (decyzja użytkownika 2026-09-27, wieczór: „asteroidy zaraz production ready”, „warp też będzie ready do
   wgrania”): asteroidy z `dema/asteroidy-webgpu` (zadanie 21) i warp „Nurt” z `dema/warp-webgpu` (zadanie 22) — po
   zakończeniu poprawek w ich sesjach. Dalej poza portem: moduły ruchu v2 jeszcze nie w grze (Z4 `shipProxyBatch3D`, Z5 `cargoContainers3D` / `cargoDrones3D`,
   Z7 `portBuildings/*` — przejdą na TSL przy swojej integracji), strony `destruktor2d/3d.html` (`beamShips3D` i spółka).
   Te dema działają z tagu `webgl-baseline` (osobny worktree).
6. **Nowe efekty broni i rakiet wchodzą przy porcie** (decyzja użytkownika 2026-09-27, po obejrzeniu dem: „bronie —
   wszystkie super”, „rakiety — super”): efekty z `dema/bronie-webgpu` (27 broni: działa, obrona punktowa, lasery —
   `DEMO-BRONIE.md`) i `dema/rakiety-webgpu` (rakiety, Supernowa — `DEMO-RAKIETY.md`) zastępują stare efekty broni,
   trafień, iskier i rakiet, zamiast przenosić je 1:1. Zadania: 12 (wspólna infrastruktura: compute w klatce, siatka
   świateł, zniekształcenia), 17–18 (broń), 19 (rakiety), 20 (koniec overlaya). Dema dostają zdarzenia gry (strzał, lot,
   trafienie), ich własne pętle (pociski 240 Hz, lot rakiet) nie wchodzą; mechanikę trafień z dema (przebicia,
   rykoszety, ładowanie, serie) przenosimy do logiki gry w zadaniu 18 — zatwierdzona zmiana rozgrywki.
   Warp „Nurt” (`dema/warp-webgpu`, `DEMO-WARP.md`) — bez decyzji (odłożony warp, §12).
7. **Warsztaty przenoszonych modułów przechodzą razem z nimi:** `dema/halo_ring_demo.html` (ring), `dema/mostki-demo.html`
   (mostki + ścieżka heksów + pomiar drżenia), `dema/rdzen-demo.html` (reaktory i rdzenie — `reactor3D.js`,
   `coreFx3D.js`, choć gra ich jeszcze nie ładuje).
8. Z listy zadań prompta wypadły: Electron / build produkcyjny i przełączenie domyślnego backendu z polityką awaryjną.

**Konsekwencja, którą użytkownik zaakceptował:** od zadania 01 do końca portu gra na `main` rysuje nieprzeniesione
materiały jako **magentowe zamienniki**. Kolejność zadań minimalizuje ten okres dla tego, co widać najczęściej.

## 2. Architektura `Core3D` na WebGPU (wyniki spike'u)

| Temat | Decyzja | Źródło |
|---|---|---|
| Renderer | `new WebGPURenderer({ canvas, alpha: true, antialias: false, trackTimestamp: true, requiredLimits })`; `await renderer.init()` → `Core3D.ready` (Promise), `isInitialized` dopiero po nim; `renderer.highPrecision = true`; `outputColorSpace = LinearSRGBColorSpace`, `toneMapping = NoToneMapping` | SPIKE 2 |
| Limity | `requiredLimits` z adaptera: `maxTextureDimension2D` (16384 — planety 8K, mapy ringu „Ultra” 16K), `maxTextureArrayLayers`, `maxSampledTexturesPerShaderStage`, `maxInterStageShaderVariables`, `maxVertexAttributes`, `maxStorageBuffersPerShaderStage`, `maxStorageTexturesPerShaderStage`, `maxColorAttachmentBytesPerSample`, `maxBufferSize`, `maxStorageBufferBindingSize`, `maxComputeInvocationsPerWorkgroup`, `maxComputeWorkgroupStorageSize` | SPIKE 2, POSTEP § Limity |
| Import | `three/webgpu` eksportuje rdzeń + renderer + materiały węzłowe; `three/tsl` — węzły. Import map w `index.html`: `three/webgpu` → `build/three.webgpu.js`, `three/tsl` → `build/three.tsl.js`. Vite: `optimizeDeps.include: ['three', 'three/webgpu', 'three/tsl']` (bez tego pierwsze wykrycie przeładowuje stronę). Jeden rdzeń klas potwierdzony w obu trybach | SPIKE 1 |
| Model klatki | **Bez `EffectComposer` i bez `pass()`/`PassNode` dla scen.** Passy scen jak dziś: kamery Core3D, warstwy 1 → 3 → (halo) → 6 → 0 → 7 → 2, wszystkie do jednego `composerTarget` (HalfFloat, MSAA 4), `renderer.autoClear = false`, czyszczenie tylko głębi między passami. Backend trzyma MSAA między `render()` (`storeOp: store`) — obejście `FullScreenBlendPass` z WebGL (inwalidacja renderbuffera) znika. `pass()` odrzucone: każdy pass = osobny cel, więc blending addytywny liczyłby się na przezroczystym celu, a tarcze straciłyby głębię passa ortho | SPIKE 4a, 4b |
| Post | `RenderPipeline(renderer, outputNode)` z `outputColorTransform = false`: `texture(composerTarget.texture)` → bloom (`BloomNode` — ten sam algorytm co `UnrealBloomPass`: 5 mipów, jądra 6…22, `bloomConfig.js`) → „uber” w TSL (gorące powietrze do 24 źródeł, dyspersja dysz, ACES **gry** — nie `acesFilmicToneMapping` three, inna krzywa — i LinearTosRGB) → kanwa. Pełnoekranowe passy pomocnicze (halo, maska słońca, resolve) = `QuadMesh` + `NodeMaterial` | SPIKE 4a, 4b |
| Zamienniki | `renderer.library.addMaterial(ZamiennikMaterial, 'ShaderMaterial')` (+ `'RawShaderMaterial'`): magenta ze stanem renderu oryginału (blending, głębia), licznik budów, `isPlaceholder = true` — harness liczy je w `spis.zamienniki`. Bez tego three loguje błąd i rysuje pusty `NodeMaterial` | SPIKE 15 |
| Materiały wbudowane | `MeshBasic/Standard/Physical/Lambert/Phong`, `ShadowMaterial`, `Sprite`, `Points`, `Line*` WebGPU zamienia sam (`StandardNodeLibrary`). Portu wymagają tylko te z `onBeforeCompile` (`applySunShadowToBuiltinMaterial`) i `customProgramCacheKey` | USTALENIA §4, INWENTARZ |
| Składanie klatki | **Bez zmian:** `drawHexShips3D` kopiuje kanwę WebGPU do `#c` w tym samym zadaniu JS; podzielony ekran = 2× `renderSingle` + wycinki. Kopiować zawsze w zadaniu renderu — po `await` kanwa bywa już pusta. Warstwa bez kopii (kanwa 3D pod 2D) — do oceny w zadaniu 23 (zysk znikomy) | SPIKE 5, 5k |
| Split w jednym renderze | `makeSplitScreenRenderPass` (gałąź split), `renderSplitScreen`, `_renderDirect` są martwe (gra robi split przez 2× `renderSingle`) i na WebGPU i tak nie działają: `clear()` czyści CAŁY cel, nożyczek nie respektuje. **Usuwamy** (zadanie 01) | SPIKE 13 |
| Viewport celu | `rt.viewport` / `rt.scissor` / `rt.scissorTest` (`renderer.setViewport` działa tylko na kanwę) | SPIKE 13 |
| Overlay efektów | `overlay3D` / `rocketOverlay3D` (`src/effects3d/overlay.js`) mają dziś **własny `WebGLRenderer`** (iskry, trafienia, wybuchy, Yamato, Supernowa, rakiety). Zostaje na nim w czasie portu (wyjątek przejściowy — stare efekty działają bez zamienników). Zadania 17–19 zabierają z niego efekty (zastąpione nowymi w scenie Core3D), 20 przenosi ostatni — wybuch reaktora — do Core3D i **usuwa overlay**: jedna kanwa 3D, jeden bloom. `CanvasTarget` + `setCanvasTarget()` działa (SPIKE 5), ale nie jest potrzebny | SPIKE 5, decyzja §1 p. 6 |
| Cienie | Mapa cienia per światło: `sun.shadow.autoUpdate = false`, `needsUpdate = true` **raz na klatkę** na starcie `Core3D.render()`. ShadowNode aktualizuje najwyżej raz na klatkę rAF (bramka `frameId` z wewnętrznej pętli renderera; `_cameraFrameId` na `WeakMap` przez `[]` = jeden slot dla wszystkich kamer), pierwsza aktualizacja mapy trwa dwa rendery. `renderer.shadowMap.autoUpdate/needsUpdate` z WebGL znikają. Warstwy: gra ustawia słońcu `shadow.camera.layers.enableAll()` — zachowanie jak w WebGL | SPIKE 9 |
| Pomiar GPU | `trackTimestamp: true` + `renderer.resolveTimestampsAsync('render')` raz na klatkę (jedno zapytanie w locie) → `Core3D.gpuFrameMs` (PerfHUD bez zmian). `EXT_disjoint_timer_query_webgl2` znika | SPIKE 8 |
| `renderer.info` | Draw calle = `info.render.drawCalls` (w WebGL `render.calls`); `render.calls` liczy wywołania `render()` i nie zeruje się w `reset()`. `info.autoReset = false` + ręczny reset raz na klatkę (przy `true` wewnętrzna pętla zeruje liczniki co rAF). `window.__rendererInfo.calls` dalej = draw calle (harness i PerfHUD) | SPIKE 14 |
| Kompilacja | `renderer.compile` = alias `compileAsync` (zwraca Promise) → wywołania w `shield3D.js`, `hexShips3D.js`, `weapon3DSystem.js` stają się asynchroniczne. WGSL przez DXC kompiluje się 2–9× szybciej niż ten sam GLSL przez ANGLE. Bez `compileAsync` pierwszy render nowego materiału oddaje CPU po ~6 ms, ale kolejka GPU czeka na kompilację (przestój klatki) | SPIKE 10 |
| Bez WebGPU | **Tylko WebGPU** (decyzja użytkownika, §12 p. 2). `WebGPURenderer` bez adaptera sam przechodzi na backend WebGL2 — nie dopuszczamy tego: przed utworzeniem renderera `navigator.gpu?.requestAdapter()`; brak adaptera → komunikat „Gra wymaga przeglądarki z WebGPU” zamiast startu; po `init()` sprawdzenie `backend.isWebGPUBackend` | źródło three, decyzja |

## 3. Konwencja modułów i materiałów

- **Nowe efekty z dem** (§1 p. 6): wspólne klocki w `src/3d/fx/` (siatka świateł, źródła świateł efektów,
  zniekształcenia, szum, pomocniki pul GPU — zadanie 12), broń w `src/3d/weapons/`, rakiety w `src/3d/rockets/`
  (17–19). Kopie klocków w demach (`lightGrid.js` ×3, `SurfaceLightingModel`, duszki) scalamy w jedną wersję gry; dem
  nie zmieniamy (ich sesje trwają). Duplikatów między demami (iskry, łuki, duszki) nie scalamy na siłę — tylko gdy obraz
  zostaje ten sam.
- **Port w miejscu.** Moduł zostaje pod swoją nazwą i API (`update(...)`, `material.uniforms.X.value`, eksporty);
  szablony GLSL zamieniają się na kod TSL. Duże ciała shaderów mogą iść do pliku obok: `nazwa.tsl.js` (inwentarz
  liczy go jako TSL modułu). Wspólne pomocniki TSL: `src/3d/tsl/` (zadanie 01: `uniformy.js`, `zamiennik.js`,
  `kolorGry.js` — ACES gry i LinearTosRGB).
- **Materiały:** `NodeMaterial` / `MeshBasicNodeMaterial` / … z `colorNode`, `positionNode`, `fragmentNode`, `outputNode`;
  własne modele oświetlenia przez `LightingModel` (wzór: `dema/asteroidy-webgpu/surfaceLighting.js`).
- **Adapter uniformów** (`src/3d/tsl/uniformy.js`): `material.uniforms = uniformsAdapter({ uFoo: uniform(0), … })`
  — kod aktualizacji się nie zmienia. `uniform()` i `texture()` mają `.value`; **`uniformArray` trzyma dane w
  `node.array`** (`node.value` to spakowany `Float32Array`), więc adapter wystawia `.value` → `node.array`
  (`Vector4.set` w miejscu działa, przepisuje się co render). Wspólne obiekty uniformów (np. `sunShadowUniforms`) =
  wspólne węzły `uniform()` — ustawienie `.value` raz działa dla wszystkich materiałów. Zmiana wartości nie przebudowuje
  pipeline'u (SPIKE 3).
- **`defines` i `needsUpdate` w biegu** (INWENTARZ § Przebudowy): w WebGPU każda nowa kombinacja = nowy pipeline.
  Przełączniki zamieniamy na gałęzie z uniformem (`If` / `select`) albo osobne, raz zbudowane materiały. Klon
  materiału ma ten sam klucz (tani w budowie), ale to nowy obiekt z własnymi wiązaniami — na strzał pule, nie klony
  (`weapon3DSystem` ma już pulę wiązek ≤ 96, audyt bitwy §2.2).
- **Wiele materiałów jednego efektu — jeden graf węzłów.** Klucz materiału węzłowego to id jego węzłów
  (`Node.customCacheKey()` = `this.id`, `NodeMaterial.customProgramCacheKey`) plus stan; `NodeManager` buduje materiał
  (NodeBuilder na CPU, generacja WGSL) raz na klucz. Nowy graf na każdy wybuch / strzał = pełna budowa na CPU za każdym
  razem (moduł GPU i pipeline trafią w cache po identycznym kodzie, ale budowa zostaje). Dlatego: graf budowany raz na
  moduł, materiały go współdzielą (`clone()` materiału węzłowego kopiuje referencje węzłów — ten sam klucz), wartości
  per obiekt przez `uniform(...).onObjectUpdate(({ object }) => …)` albo atrybuty instancji. Materiały wbudowane
  (`SpriteMaterial`, `MeshBasicMaterial` tworzone per wybuch) konwertują się z tym samym kluczem — tanie. Sprawdzone w
  Node (`customProgramCacheKey`): dwa materiały z osobnymi `uniform()` — różne klucze; `clone()` i wspólny graf — ten sam;
  dwa `SpriteMaterial` o różnych kolorach — ten sam. Dotyczy dziś m.in. kadłubów (materiał na encję, 04) i tarcz (14).
- **Światła:** klucz materiałów oświetlanych zawiera id KAŻDEGO widocznego światła passa (`LightsNode.customCacheKey`);
  WebGL patrzył tylko na liczbę świateł danego typu. Przełączanie `light.visible` w biegu (pule świateł) = przebudowa
  materiałów oświetlanych przy każdej nowej kombinacji. Dziś światła silników (`perfToggles.enginePointLights`) i trafień
  (`BEAM_ENABLE_IMPACT_LIGHT`) są wyłączone — przy włączaniu: stały zbiór świateł, gaszenie przez `intensity = 0`.
- **Limit 12 buforów uniformów na etap shadera** (twardy — adapter RTX 5080 też daje 12; potwierdzone w zadaniu 06 i w
  demie asteroid): każdy `uniformArray` i każda grupa uniformów to osobny bufor. Duże materiały pakują uniformy w JEDEN
  blok (`createUniformBlock` w `src/3d/haloRing/`, stała nazwa bloku = wspólne programy dla wielu instancji).
- **Błąd three r183 — `Fn(...).setLayout(...)` z uniformem w domknięciu** jest buforowane globalnie: drugi materiał czyta
  slot pierwszego (sprawdzone w Node, zadanie 06). Funkcje z layoutem mają być CZYSTE — uniformy podawane parametrami;
  funkcje z tablicami / teksturami / macierzami wklejane bez layoutu.
- **Hasze float z niecałkowitych wejść** różnią się między kompilatorami (FXC w bazie WebGL, DXC przez Tint w WebGPU):
  wejścia haszy trzymaj całkowite — wtedy wynik jest bit w bit (zadanie 06).
- **Kolejne pułapki WGSL / TSL (zadanie 07):** stałe `smoothstep` z odwróconymi krawędziami (e0 > e1) są w WGSL błędem
  kompilacji — pomocnik `haloSmooth`; `screenCoordinate` liczy y od GÓRY (dither 1:1 z WebGL przez `haloFragCoordGL`);
  `texture()` bez jawnego uv dostaje własny uniform mat3 (`updateMatrix`) — podawaj uv, żeby nie zjadać limitu 12
  buforów; FXC liczy `a·b + c` z jednym zaokrągleniem, DXC z dwoma — hasze z mnożenia i dodawania przez
  `haloFusedMulAddInt` (bit w bit z bazą WebGL).
- **TSL, nie `wgslFn`.** Tekstowy WGSL tylko dla wyizolowanej czystej funkcji, gdy TSL jest naprawdę niewygodny — z
  uzasadnieniem w commicie (zamyka drogę do zapasowego backendu WebGL2).
- **Pętle:** `Loop` w TSL, nie `for` w JS generujący kopie (`mx_noise_float` ×160 rozwinięte = 44 s kompilacji).
  Ciężkie funkcje: `Fn(...).setLayout(...)` — jedna funkcja WGSL zamiast wklejania.
- **Reguły z `agents.md` bez zmian:** HDR-first i próg bloomu 0,9; bez `pow()` z ujemną podstawą; clamp varyingów
  (MSAA + HalfFloat); `forceSinglePass: true` dla przezroczystych `DoubleSide` (WebGPU też rysuje je dwa razy);
  zero alokacji per klatka; zgłaszanie aktywności warstw 3/5/6/7; maska cienia słońca w materiałach oświetlanych.

## 4. Precyzja

`renderer.highPrecision = true` składa `modelViewMatrix` na CPU w double; dotychczasowa reguła („duży offset w
`mesh.position`, dane instancji względem niego”, `sceneOrigin.js`) daje **0,001 px** także dla `InstancedMesh`;
instancje z bezwzględną pozycją świata drgają 0,47 px niezależnie od flagi (SPIKE 11). Shadery TSL używają węzła
`modelViewMatrix` — ręczne `cameraViewMatrix.mul(modelWorldMatrix)` omija `highPrecision`. Ring liczy RTE sam
(`uCamLocal`). Flaga wchodzi w program przy budowie materiału. Pomiar na WebGPU: `dema/precyzja-drzenie.js`
(działa po zadaniu 15 — stoi na `mostki-demo`), baza w `baseline.json` § drzenie.

## 5. Cienie słońca (shadow shafts) i SDF kadłubów

Maska widoczności słońca (`sunShadowTarget`, RGBA8, rozmiar bufora sceny) liczona raz na klatkę przed passami:
tarcze planet, pola odległości kadłubów (tablica warstw `HullShadowSdf`), okręgi ringów, pole przesłaniające.
Biblioteka `SUN_SHADOW_GLSL` → funkcje TSL (`sunVisibility`, `sunFill`, `sunShadeUnlit`, `sunShaftBackdrop`) z
próbkowaniem po **`screenUV`** (w WebGPU oś Y ekranu rośnie w dół — nie przenosić `gl_FragCoord * texel` wprost;
snapshot refrakcji w połowie rozdzielczości musi dalej trafiać w teksel). `applySunShadowToBuiltinMaterial`
(`onBeforeCompile`) → materiał węzłowy z modelem oświetlenia mnożącym człon bezpośredni. `HULL_SDF_SHADOW_GLSL` →
TSL w zgodzie z lustrem `traceHullShadowCpu` (test). Do zadania 03 maska jest wyłączona (`uSunShadowOn = 0`).

## 6. Asynchroniczność

- **Start:** `Core3D.init()` tworzy renderer i zwraca `Core3D.ready`; pierwsze `render()` / `renderBackdrop()` po nim.
  Moduły tworzące zasoby GPU przy starcie (cele, `compileAsync`, pieczenie) czekają na `ready`.
- **Ring:** `haloRingWorldGen._readbackCpu` (mapa wysokości 2048 × ~96 RGBA32F) → `readRenderTargetPixelsAsync`:
  wiersze wyrównane do 256 B (wynik nieprzycięty), wiersz 0 = GÓRA celu (odwrotnie niż `readPixels`), 4–8 ms (pierwszy
  ~30 ms). Pieczenie w TSL po `uv` pisze v = 0 u GÓRY celu, więc mapa CPU i próbkowanie w materiałach zgadzają się BEZ
  odwracania (zadanie 06, zgodność z WebGL sprawdzona). Budowa ringu jest asynchroniczna: `createHaloRing` wraca od razu,
  bryły / hale K-7 / mapa CPU po `await ring.ready`; `HaloRingGame` podpina teren do kolizji po `ready`.
  Mapa CPU steruje kolizjami (`terrainHeightAt`), LOD terenu, rozstawieniem budowli i wysokością kamery — ring nie
  może zgłosić gotowości przed odczytem (inaczej zmienia się gameplay). Harness czeka na `mapsReady`.
- **Rozgrzewka:** tło menu rozgrzewa pieczenie ringu i jego materiały przez `compileAsync` na tych samych obiektach
  (klucz pipeline'u WebGPU ≠ klucz programu WebGL — `createHaloBakeWarmup` do przeprojektowania, zadanie 11).
- **`compileAsync` odtwarza pass, nie „wszystkie materiały sceny”** (źródło: `Renderer.compileAsync` →
  `_projectObject`): pomija obiekty `visible = false`, spoza warstw kamery i spoza frustum (chyba że
  `frustumCulled = false`), a pipeline kompiluje dla BIEŻĄCEGO celu (`renderer.setRenderTarget` — format, MSAA) i
  świateł widocznych w tym passie. Rozgrzewka modułu = `setRenderTarget(composerTarget)` + kamera passa z jego warstwą
  + obiekty widoczne w kadrze (albo `frustumCulled = false` na czas kompilacji). Rozgrzewka na kanwie (bgra8unorm,
  bez MSAA) nic nie daje — pierwszy prawdziwy draw i tak skompiluje pipeline od nowa.
- **Trzymacze programów zostają:** `NodeManager` usuwa stan budowy materiału, gdy ostatni obiekt przestaje go używać
  (`usedTimes === 0`), a `Pipelines` zwalniają nieużywane moduły shaderów — tak jak WebGL zwalniał programy. Próbki
  z rozgrzewki efektów (overlay, tarcze) dalej trzymamy bez `dispose` (test `shaderPrewarm` — odpowiednik w 14, 19, 20).
- Odczyty tworzą bufor mapowany na każde wywołanie (bez puli) — nie w pętli klatki.

## 7. Weryfikacja

- **Harness:** `node scripts/webgpu/zrzuty.mjs --backend webgpu --out .tmp/webgpu/zadania/NN --baza .tmp/webgpu/baseline/webgl/p1`
  — 16 scen + 32 warianty „jedna warstwa” (`__tlo`, `__planety`, `__ortho`, `__fg`), deterministycznie (zegar
  wirtualny, ziarno per scena, dyspozytor rAF — dwa przebiegi WebGL różnią się ≤ 0,03% pikseli). Wynik:
  `wyniki.json` (błędy konsoli z walidacją WebGPU, draw calle per pass, ms CPU / GPU, HDR, **spis materiałów per
  warstwa z licznikiem zamienników**), `porownanie-z-baza/porownanie.md` (+ mapy różnic i zestawienia obok siebie).
- **Baza:** tag `webgl-baseline` (gra na WebGLRenderer + harness). PNG w `.tmp/webgpu/baseline/webgl/p1` (nie w repo);
  odtworzenie: worktree z tagu + to samo polecenie (`README.md`). Nowa scena bazy = dopisać ją w `zrzuty.mjs`,
  skopiować `scripts/webgpu/` do worktree z tagu i zrobić tam bazę tej sceny.
- **Tolerancja portu** (`baseline.json` → `tolerancjaPortu`): wstępnie 2% pikseli > 8/255 i średnia ≤ 1,0.
  **Kalibruje ją zadanie 02** na `kalibracja__ortho` (same wbudowane materiały three — bez zamienników już po 01–02)
  i `slonce`; zapisuje wartości z uzasadnieniem. Scena „w tolerancji”, gdy jej warstwy nie mają zamienników.
- **Postęp i regresje:** każde zadanie porównuje się też z poprzednim przebiegiem WebGPU
  (`porownaj.mjs --a .tmp/webgpu/zadania/<poprzednie>/webgpu --b .tmp/webgpu/zadania/NN/webgpu`) — zmiany mają być
  tylko w warstwach zadania. `spis.zamienniki` maleje do zera.
- **Determinizm a port:** kod JS modułów nie może zmieniać liczby ani kolejności wywołań `Math.random` (rozjadą się
  sceny dynamiczne względem bazy); jeśli musi — nowa baza tej sceny z tagu.
- **Testy** (`INWENTARZ.md` § Testy + lista niżej): testy czytające GLSL przepisujemy na odpowiedniki TSL (struktura
  węzłów, zachowanie, lustra CPU) w zadaniu, które przenosi moduł — nie usuwamy ich. Baza porażek: `POSTEP.md`.
  W Node `three/webgpu` i `three/tsl` ładują się bez GPU (sprawdzone: ten sam rdzeń klas co `three`, materiały węzłowe
  i węzły TSL da się budować i czytać w teście), więc test może sprawdzać graf / stan materiału zamiast tekstu GLSL.
  `node --test tests/` na Node 22 nie działa — `node --test "tests/*.test.mjs"`.
- **Nowe efekty (17–19) nie mają bazy w tagu** — stare efekty broni i rakiet wyglądają inaczej. Kryterium: zrzuty gry
  obok zrzutów dema (te same bronie / scenariusze) i ocena użytkownika; po akceptacji przebieg z `main` (`galeria-broni`,
  `galeria-rakiet`, bitwy) staje się bazą tych scen na przyszłość. Reszta scen i warianty bez broni — dalej tolerancja
  względem tagu.
- **Wydajność:** `coreRenderMs` / `gpuMs` scen w `wyniki.json` (orientacyjnie); pełne A/B w zadaniu 23 (bitwa
  `zrzuty.mjs --wydajnosc`, naprzemiennie tag ↔ `main`, bez innych obciążeń GPU; koszt samego portu osobno od kosztu
  nowych efektów).

Testy do przepisania (mapa z Fazy 0; zadanie w nawiasie): `glslReservedWords` (01: próg „> 50 shaderów” → „jeśli
są”; 24: zamiana na strażnika „brak GLSL w plikach gry”), `renderPerfGates`, `perfInstrumentation`, `sceneMatrixSync`,
`fighterCombatFixes`, `warpLens3D` / `warpSpace` / `warpWorldLens` (01: asercje o passie soczewki w `core3d.js`
znikają, matematyka CPU zostaje), `ringPlanetAnchoring` (01, 05), `shipLights3D` (01, 15), `shadowShaftsQuality`
(01, 03, 05), `renderBugfixGuards` (02, 04, 13, 19, 20), `hullShadowSdf` (03), `hexShips3DShader`, `hexDebrisPool`,
`shipProxyBatch3D` (04 — parzystość z shaderem proxy Z4 poza portem: oznaczyć), `starParallax` (05),
`haloRingProfiles`, `haloRingRoofPlan` (06, 07), `haloPortK7`, `haloRingArch` (10), `menuBackdrop` (11),
`carrierVelocity` (12, 17), `weapon3DModelMaterials`, `turret2D`, `fighterCombatFixes` (17), `pulseBeamPoolLimit`,
`beamRenderPath` (18 — laser PD przechodzi z kanwy do 3D, decyzja §1 p. 6), `warpPlume3D` (13), `shieldImpactFx` (14),
`shaderPrewarm` (14, 19, 20), `bridge3D`, `reactor3D`, `shipLightRuntime` (15), `collisionSparks`, `collisionFx`,
`rocketGuidance` (19 — API iskier i lot rakiet bez zmian), `overlayContextMerge` (20 — strażnik jednego renderera).

## 8. Zakres i rozmiar

Inwentarz (HEAD 2026-09-27): w porcie **44 pliki z GLSL, 71 miejsc tworzenia materiałów, 9061 linii GLSL**
(+ `reactor3D.js` 222 i `coreFx3D.js` 280 — warsztat rdzeni), 51 miejsc z materiałami wbudowanymi (same się
konwertują), 1 `onBeforeCompile`, 1 odczyt pikseli (ring), 5 `compile`. Ring = ~4,4 tys. linii (47% portu).
Poza portem: warp 364, stare asteroidy 66, nowe asteroidy 1889, legacy `planet3d.proc.js` 392, poza grą 2226.
Z portu ~1070 linii GLSL nie przenosimy, tylko zastępujemy efektami z dem (§1 p. 6): `slugTrail3D` 75, `sparkSystem3D`
112, `rocketFireGPU` 213, `rocketSmokeGPU` 74, `yamato` 328, `supernovaMissileBlow` 230, `RestoreAlphaShader` overlaya
36 — plus moduły bez własnego GLSL (`weapon3DSystem`, `muzzleFx3D`, `railgunFx3D`, trafienia overlaya). Dochodzi kod
dem do wpięcia: broń ~5,5 tys. linii JS/TSL, rakiety ~5 tys. (część to pokaz, nie wchodzi).

## 9. Zadania

Kolejność: fundament → post → biblioteki cieni → rodziny materiałów (najpierw najczęściej widoczne) → infrastruktura
efektów i nowe efekty z dem → koniec overlaya → wydajność → sprzątanie. Pliki zadań: `docs/webgpu/zadania/NN-*.md`
(każdy = samodzielny prompt dla świeżej sesji).

| # | Zadanie | Zależy od | Równolegle z | Effort | Zakres (mat. / linie GLSL) |
|---|---|---|---|---|---|
| 01 | Fundament: WebGPURenderer w Core3D, zamienniki, adapter uniformów, harness na WebGPU | — | nie | max | core3d (resolve, halo-blend, uber bez haze), index.html, vite.config, `src/3d/tsl/*` |
| 02 | Post 1/2: bloom, pełny „uber”, pre-pass halo, MSAA, kalibracja tolerancji | 01 | 06 | max | core3d uber 143 |
| 03 | Post 2/2 + biblioteki cieni: maska słońca, SDF kadłubów, refrakcja, fala uderzeniowa | 02 | 06 | max | core3d shafts 147, hullShadowSdf 69, sunShadowMask 36 + oBC, shockwave3D 50 |
| 04 | Kadłuby: hexShips3D (belki + heksy), lakier, impostory wraków, szczątki | 03 | 05–14, 16, 19 | max | 7 / ~610 |
| 05 | Planety, słońce, mgławica, gwiazdy, stacje | 03 | 04, 06–10, 12–20 | xhigh | 7 / 191 + wbudowane |
| 06 | Ring 1/5: biblioteka TSL ringu, pieczenie map, odczyt asynchroniczny, halo_ring_demo | 01 | 02–05, 12–20 | max | 3 / ~1100 |
| 07 | Ring 2/5: teren + zestaw przemysłowy | 06 | 04, 05, 12–20 | xhigh | 1 / ~650 |
| 08 | Ring 3/5: struktura + atmosfera | 07 | j.w. | xhigh | 3 / ~700 |
| 09 | Ring 4/5: megastruktura + miasto (+ kopuły, landmarki) | 08 | j.w. | xhigh | 7 / ~910 |
| 10 | Ring 5/5: K-7 + ringi-archetypy Marsa i Jowisza | 09 | j.w. | xhigh | 7 / ~1050 |
| 11 | Tło menu: Ziemia z ringiem, niebo, rozgrzewka pipeline'ów | 05, 10 | 12–20 | max | 3 / 200 |
| 12 | Infrastruktura efektów GPU w Core3D: compute w klatce, siatka świateł, zniekształcenia, Fx3D w TSL | 03 | 04–11, 13–16 | max | 1 / 67 + nowe `src/3d/fx/` |
| 13 | Silniki: MAIN, WARP (plazma), SIDE | 03 | 04–12, 14–20 | xhigh | 6 / 517 (+90 martwe) |
| 14 | Tarcze i trafienia w tarczę | 03 | 04–13, 15–20 | xhigh | 4 / 583 |
| 15 | Mostki, rdzenie, reaktory, światła statków (+ warsztaty mostki-demo, rdzen-demo; pełny pomiar drżenia w 21) | 04 | 05–14, 16–20 | xhigh | 9 / ~1000 |
| 16 | Zniszczenie stacji (shatter, panele) + nowa scena bazy `stacja-rozpad` | 03 | 04–15, 17–19 | xhigh | 2 / 172 + wbudowane |
| 17 | Broń 1/2 z dema `bronie-webgpu`: efekty wszystkich broni (wylot, pocisk, smuga, trafienie, wiązki, PD, flak; Hexlance, Yamato) | 12, 04 | 05–11, 13–16, 19 | max | zastępuje ~400 linii GLSL (`slugTrail3D`, `yamato`) + `weapon3DSystem`, `muzzleFx3D`, `railgunFx3D`, trafienia overlaya; PD i flak z kanwy do 3D |
| 18 | Broń 2/2: obrażenia z dema — mapa ran na kadłubach, przebicia, rykoszety, ładowanie, serie; światła efektów na poszyciu | 17, 04 | 05–11, 13–16, 19 | max | materiał kadłuba + logika trafień (zmiana rozgrywki zatwierdzona) |
| 19 | Rakiety z dema `rakiety-webgpu`: dym GPU, dysze, kule ognia, Supernowa, iskry | 12 | 05–11, 13–18 | max | zastępuje ~630 linii GLSL |
| 20 | Koniec overlaya: wybuch reaktora w Core3D, usunięcie drugiego renderera | 17, 18, 19 | 13–16 | xhigh | 2 / 226 + overlay 36 + drugi renderer |
| 21 | Asteroidy z dema `asteroidy-webgpu` (pola, skały, minerały, olbrzymy, światło wolumetryczne, burze) + rozgrywka pól | 12, 04, 05 (+ zakończenie sesji dema) | 13–20 (bez `src/3d/fx/`) | max | nowe moduły TSL/compute; stare asteroidy do usunięcia |
| 22 | Warp „Nurt” z dema `warp-webgpu` (ładowanie, skok, podróż, wyjście, przylot NPC; pass zgięcia tła) | 12, 13 (+ zakończenie sesji dema) | 14–21 | max | nowe moduły TSL/compute w miejscu opisanym w `Core3D.render()` |
| 23 | Wydajność i precyzja: A/B z tagiem, drżenie, kompilacja, pamięć | 04–22 | nie | max | pomiary |
| 24 | Sprzątanie i domknięcie portu | 23 | nie | xhigh | resztki, strażnicy, agents.md |

„Równolegle z” = rozłączne pliki; każda równoległa sesja we własnym worktree (`README.md`). Zalecane maks. 2–3 naraz
(GPU wspólne dla pomiarów harnessu).

**Scena overlay** (`src/effects3d/overlay.js`, do zadania 20 na własnym `WebGLRenderer`): iskry trafień i tarcia
(`SparkSystem3D`, `index.html: SparkSystem3D.init(ov.scene)`), wybuchy i trafienia (`reactorblow`, `yamato`,
`supernovaMissileBlow`, `railgunExplosion`, `armataImpact`, `autocannonImpact`) i rakiety (warstwa raw). Materiału w tej
scenie nie da się przenieść na TSL, dopóki rysuje ją `WebGLRenderer` — dlatego stare efekty overlaya działają w porcie
bez zamienników aż do zastąpienia: trafienia i Yamato w 17, iskry, rakiety i Supernowa w 19, wybuch reaktora (jedyny
przenoszony 1:1) w 20, które usuwa overlay. `rdzen-demo` ma własny overlay — przepina go 20.

**Nowe efekty a kadłuby:** światła efektów oświetlają kadłuby przez siatkę świateł (12 → 18), mapa ran z dema broni
na kadłubach belkowych (18), cień dymu rakiet (19) — wszystko wymaga materiału kadłuba z 04. Wieżyczki zostają 2D
(`Turret2D`).

## 10. Ryzyka

1. **Okres magenty na `main`** — gra długo wygląda na zepsutą; kolejność zadań (kadłuby, planety, ring, broń wcześnie).
2. **Ring (47% portu)** — duże shadery i wspólna biblioteka; błąd w bibliotece psuje 13 plików. Zadanie 06 przenosi ją
   w całości z testami parzystości (hash dachu, zestaw przemysłowy) przed materiałami.
3. **Asynchroniczna mapa ringu** — kolizje i LOD zależą od odczytu; bramka gotowości (ring nie istnieje dla gry, dopóki
   mapa CPU nie wróci). **Okno przejściowe:** od zadania 01 do 06 `readRenderTargetPixels` nie istnieje, więc mapa CPU
   ringu jest pusta — płyta ringu dalej koliduje, ale bez rzeźby terenu. Dlatego 06 idzie zaraz po 01 (równolegle z 02–03);
   zadanie 01 zapisuje to w `POSTEP.md` jako znaną, przejściową regresję.
4. **`Texture.updateRanges` ignorowane przez backend WebGPU** — częściowe aktualizacje tekstur (np. wiersze obrażeń
   mostków) stają się pełnym uploadem; mierzyć (zadania 04, 15, 23).
5. **Koszt CPU backendu WebGPU** przy wielu małych draw callach — gra jest ograniczona przez CPU w dużych bitwach
   (fizyka); sam port nie przyspieszy klatki. Mierzyć, nie obiecywać (zadanie 23).
6. **Przepisywanie testów-strażników** może je osłabić — zasada: odpowiednik TSL albo test zachowania, nigdy samo
   usunięcie; lustra CPU zostają.
7. **Równoległe sesje** (ruch v2 Z-zadania, dema `dema/*-webgpu/` powstające obok) mogą dotykać `core3d.js`,
   `index.html`, modułów portu — koordynacja przez użytkownika; nowy kod renderu tylko w TSL (`agents.md`).
8. **Tylko WebGPU** — maszyna bez WebGPU nie uruchomi gry (komunikat; decyzja użytkownika, §12 p. 2).
9. **Pomiar drżenia** stoi na `mostki-demo` (ścieżka heksów) — do zadania 15 nie ma pomiaru precyzji na WebGPU
   (w zadaniach 04–14 wystarcza reguła `highPrecision` + offset i zrzuty); moduły efektów w narzędziu przepina 23.
10. **Nowe efekty w prawdziwej bitwie** (17–19) — dema pokazują kilka okrętów; gra ma setki pocisków, ~100 trafień/s,
    salwy rakiet i 125+ okrętów. Budżety pul, LOD po rozmiarze na ekranie i koszt siatki świateł w materiałach mierzyć
    w bitwie przed akceptacją; ocena wyglądu należy do użytkownika (brak bazy w tagu).
11. **Dema żyją dalej** (sesje równoległe zmieniają `dema/*-webgpu` i trzy kopie siatki świateł) — zadania 12 i 17–19
    biorą stan dema z dnia integracji (commit w raporcie) i nie edytują dem.

## 11. Poza zakresem

Moduły Z4/Z5/Z7 (przejdą na TSL przy integracji), demo fizyki belek na GPU
(`FIZYKA-BELEK-GPU.md` — „może na później”), zmiany rozgrywki poza zatwierdzoną mechaniką broni z dema (18), symulacje
z dem jako takie (pociski 240 Hz, lot rakiet, `Gunnery` — mechanikę przenosimy do logiki gry, nie ich pętle), wieżyczki
3D z dema broni, wspólne urządzenie GPU z solverem sprężyn (`destructorGpuSoftBody*` ma własne `GPUDevice` i zostaje —
dwa urządzenia działają obok siebie), Electron i build produkcyjny.

## 12. Pytania do użytkownika — odpowiedzi (2026-09-27, wieczór)

1. **GLSL w modułach poza grą:** „usuwać nieużywane, przechodzimy w pełni na WebGPU” → zadanie 24 kasuje martwy
   i nieużywany kod (legacy `planet3d.proc.js`, `voxelShips3D`, `stationDestructionEffects`, martwe części
   `Engineeffects.js`, stara soczewka warpa po 01, stare tło pasa); moduły rozwijane (Z4/Z5/Z7, nowe asteroidy) przejdą
   na TSL przy swojej integracji.
2. **Brak WebGPU:** „WebGPU-only” → bez zapasu WebGL2; gra bez adaptera WebGPU pokazuje komunikat (zadanie 01).
3. **`src/3d/modelBaker.js`:** usunąć (zadanie 01 — razem z importem w `devTools.js`).
4. **Push:** użytkownik ma kopię na bieżąco i nie sprawdza po drodze — commity lokalne na `main`, bez `git push`
   (wypchnięcie tylko na wyraźną prośbę).
5. **Sesje równoległe:** skończyły pracę — port prowadzi jedna sesja (orkiestrator + podagenci w worktree).
6. **Nowe efekty z dem:** wchodzą (§1 p. 6; zadania 12, 17–20).
7. **Obrażenia i mechanika broni z dema** (mapa ran, przebicia, rykoszety, ładowanie Mjolnira, serie Hexlance'a, pola
   `recoil` / `shake` / `impactScale`): „tak, bardzo mi się podobają nowe obrażenia od broni w demie — trzeba to
   wdrożyć” → zadanie 18 (zmiana rozgrywki zatwierdzona). Demo fizyki belek na GPU — „może na później” (poza portem).
8. **Warp:** użytkownik zlecił osobnej sesji poprawę „Nurtu” (lot dobry, ładowanie i wyjście gorsze od „portalu”);
   potem „warp też będzie ready do wgrania” → zadanie 22 po zakończeniu tamtej sesji.
9. **Asteroidy:** „zaraz będą production ready — zielone światło” (po poprawkach w sesji dema) → zadanie 21.
10. **Koniec pracy:** „jak skończysz i wszystko będzie wdrożone (WebGPU w grze, bronie, rakiety, asteroidy, warp,
   ringi) — wyłącz komputer”. Przed wyłączeniem: wszystko zacommitowane, inne sesje bezczynne.
