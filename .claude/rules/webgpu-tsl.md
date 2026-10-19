---
paths:
  - "src/3d/**"
  - "src/vfx/**"
  - "dema/**"
---

# Render WebGPU + TSL: zasady, pułapki three r183, rozgrzewka, pisanie modułów 3D

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Render: WebGPU + TSL

Port renderu z WebGL na WebGPU jest zakończony (zadania 01–24, 2026-09-28). Historia, decyzje i pomiary: `docs/webgpu/`
(`PLAN.md`, `POSTEP.md`, `WYDAJNOSC.md`, `README.md`); obraz sprzed portu — tag `webgl-baseline`.

- **Jeden renderer, jeden język shaderów.** `Core3D` tworzy wyłącznie `WebGPURenderer` (`three/webgpu`, three r183); materiały
  i shadery tylko w **TSL** (`three/tsl`, materiały węzłowe), wspólne pomocniki w `src/3d/tsl/`. W plikach ładowanych przez grę
  nie ma GLSL, `ShaderMaterial` / `RawShaderMaterial`, `onBeforeCompile`, `WebGLRenderer`, celów WebGL ani `EffectComposer` —
  pilnuje `tests/graBezGlsl.test.mjs` (graf importów od `index.html`, wzorce i lista wyjątków `POZA_PORTEM` w
  `scripts/webgpu/grafGry.mjs`; inwentarz `node scripts/webgpu/inwentarz.mjs` liczy to samo). Tekstowy WGSL (`wgslFn`) tylko
  dla wyizolowanej czystej funkcji, gdy TSL naprawdę nie wystarcza — z uzasadnieniem w commicie (dziś `haloFma` / `haloFmaVec2`:
  `fma()` WGSL, TSL r183 go nie ma).

- **Moduły poza grą** — ruch v2 (Z4 `shipProxyBatch3D`, Z5 `cargoContainers3D` / `cargoDrones3D`, Z7 `portBuildings/*`) są
  na TSL od 2026-10-03 (demo `dema/budowle-portowe.html` na Core3D, `dema/kontenery.html` na `WebGPURenderer` jak demo
  ringu — od 2026-10-04; bez wpisów w `Core3D.warmup` — dopisać przy integracji);
  dema destruktora (`beamShips3D`, pula `beamDebris3D`, własny `WebGLRenderer`) mają jeszcze GLSL / WebGL i przejdą na
  WebGPU przy swojej integracji (notatki `AGENT:` w plikach). ShaderMaterial na Core3D rysuje się **magentowym zamiennikiem**
  (`src/3d/tsl/zamiennik.js` — bezpiecznik w biegu: ostrzeżenie raz na nazwę, harness liczy `spis.zamienniki`; w grze 0).

- **Tylko WebGPU:** przed rendererem `navigator.gpu.requestAdapter()`; bez adaptera renderer nie powstaje, `Core3D.ready` →
  `false`, menu pokazuje „Gra wymaga przeglądarki z WebGPU” (bez zapasu WebGL2: `_getFallback = null`). `init()` jest
  synchroniczne (scena, kamery, cele → `isInitialized`), urządzenie powstaje w tle: `Core3D.gpuReady` / `Core3D.ready`
  bramkują render, kompilację i wgrywanie tekstur, a `Core3D.renderer` istnieje dopiero przy gotowym urządzeniu. Limity z
  adaptera (`GPU_REQUIRED_LIMITS`), `highPrecision = true`, wyjście liniowe bez tone mappingu (ACES gry i sRGB w poście —
  `src/3d/tsl/kolorGry.js`, `outputColorTransform = false`). Anizotropia tekstur: `Core3D.getMaxAnisotropy()`
  (WebGPURenderer nie ma `capabilities`).

- **Graf węzłów raz, wartości per obiekt** (`docs/webgpu/PLAN.md` §3): klucz programu materiału węzłowego to id jego węzłów,
  więc graf buduje się RAZ na moduł / rodzaj / wariant (NodeBuilder kosztuje ~1–12 ms CPU), a obiekty dostają lekkie
  materiały na WSPÓLNYCH węzłach (`clone()` materiału węzłowego kopiuje referencje węzłów — ten sam klucz). Wartości per
  obiekt: `material.uniforms` (obiekty `{ value }`, adapter `src/3d/tsl/uniformy.js` — kod aktualizacji jak dawniej) czytane
  przez `uniform().onObjectUpdate`, bufory storage ze slotem (`HullObjectStore`, `HullLightStore`) albo atrybuty instancji;
  tekstura per obiekt — `teksturaObiektu` (`src/3d/tsl/`), `HullObjectTextureNode`. `defines` i `needsUpdate` w biegu = nowy
  pipeline przy każdej kombinacji → gałąź z uniformem (`If` / `select`) albo osobny materiał budowany raz. Klucz materiałów
  oświetlanych zawiera id każdego widocznego światła passa — nie przełączaj `light.visible` w biegu (stały zbiór świateł,
  gaszenie przez `intensity = 0`).

- **Kompilacja i rozgrzewka:** pierwszy zwykły rysunek nowego materiału tworzy pipeline SYNCHRONICZNIE — proces GPU
  kompiluje shader, a strona staje na nim przy najbliższym zapisie do kolejki (w profilu wygląda to jak wielosekundowy
  `writeBuffer`: pierwsza klatka ringu w menu stała 4–5,6 s); `compileAsync` robi to w tle. Nowy obiekt z nowym materiałem →
  rejestr `Core3D.warmup` (§ „Rozgrzewka pipeline'ów” przy menu) albo `Core3D.prewarmPass(obiekt, warstwa)` (cel
  `composerTarget`, kamera passa z warstwą, bez cullingu); pass mapy cienia słońca — `Core3D.prewarmShadowPass(obiekt)` /
  wpis z `shadow: true` (pułapki 20, 32). `renderer.compile` to alias `compileAsync`; każde `compileAsync` na
  celu przez `compileAsyncNaCelu` (pułapka 30). three r183 wkłada pipeline z `compileAsync` do cache, zanim GPU go odda —
  zwykły rysunek tego klucza wołał `setPipeline(undefined)`; Core3D osłania `backend.draw` (`_guardPendingPipelines`: taki
  rysunek czeka klatkę, dwie) i loguje połknięte błędy `createRenderPipelineAsync`. `renderer.info`: draw calle w
  `render.drawCalls` (reset raz na klatkę rAF). Zegar GPU: znaczniki czasu (`trackTimestamp`) co `gpuTimerSampleEvery` klatek,
  jedno zapytanie w locie → `Core3D.gpuFrameMs`; mapę `timestamps` puli three czyści Core3D (three tego nie robi).

- **Weryfikacja:** harness zrzutów `node scripts/webgpu/zrzuty.mjs --backend webgpu --out .tmp/webgpu/<katalog> --baza
  .tmp/webgpu/baseline/webgl/p1` (sceny deterministyczne; błędy konsoli z walidacją WebGPU, draw calle per pass, HDR, spis
  materiałów z `spis.zamienniki`; `--uuid osobne` = UUID three z osobnego strumienia — bez tego tysiące węzłów TSL przesuwają
  `Math.random` gry i świat wychodzi inny niż w bazie; tryb bierze się z bazy). **Bazy:** sceny przeniesione 1:1 (menu, ring,
  K-7, planety, słońce, kalibracja, stacje, wybuch reaktora, podzielony ekran) — z tagu `webgl-baseline`; sceny z nowymi
  efektami z dem (galeria broni i rakiet, bitwy, wraki, warp, pas asteroid, wydobycie) — z zatwierdzonego przebiegu `main`
  (`scripts/webgpu/porownaj.mjs --a <baza main> --b <nowy>`); szczegóły: `docs/webgpu/README.md`. A/B zrzutów (wersja kodu, flaga) — przebiegi PO KOLEI, nie dwa harnessy naraz: sceny z wgrywaniem „w wolnej chwili” (mapa powierzchni kadłuba z workera przez `requestIdleCallback` — nowy okręt tuż przed zrzutem: `galeria-ladowanie`, `galeria-broni`, `warp-przylot`) zależą od czasu CPU klatki; różnicę sprawdzaj próbą samego opóźnienia (2026-10-16, RW-10). Haki `?dev`:
  `window.DevScene.teleport / syncCamera / preloadHullSprites / startSplit`. Testy: `node --test "tests/*.test.mjs"` (wzorzec w
  cudzysłowie — `tests/` na Node 22 nie działa) i `npm test`.

- **Resize celów:** `src/3d/renderTargetResize.js` (`resizeRenderTarget`) — `RenderTarget.setSize` r183 zwalnia GPUTexture przez `dispose` celu, bez zmiany `texture.version`; stare wiązania próbkowania nie widzą utraty zasobu. Zmieniony rozmiar → `needsUpdate` wszystkich tekstur celu + `renderer.initRenderTarget` przy gotowym GPU. To obowiązuje także nieaktywne cele (DIST w menu, halo poza kadrem): uniform wyłączający odczyt nie usuwa wiązania shadera. Bez tego przebudowa grupy wiązań po resize może rzucić `Cannot read properties of undefined (reading 'mipLevelCount')`. Test: `tests/renderTargetResize.test.mjs`; stres w grze: `node scripts/webgpu/resize-gra.mjs` (menu / gra / wyłączone efekty, rozmiar i DPR, oba pipeline'y postu).

## Pułapki three r183 / TSL / WGSL (sprawdzone w porcie)

Zanim napiszesz materiał albo pass — przeczytaj. Numery (1)–(31) przywołują inne miejsca (PLAN, komentarze w kodzie).

- **Pułapki TSL z zadania 04** (reszta — w notce „TSL — pułapki sprawdzone w zadaniach 02, 06–09” niżej): **najwyżej 8
  buforów wierzchołków na pipeline** (`maxVertexBuffers` = 8 także w adapterze RTX 5080) — każdy nieprzeplatany atrybut
  to bufor, InstancedMesh dokłada macierz instancji (+ normalne); stałe atrybuty przeplataj, a materiał liczący pozycję
  sam (`vertexNode`) na InstancedMesh nadpisuje `setupPosition` (wzór `RepairDroneNodeMaterial`, `src/3d/repair/repairDrones3D.js`). three połyka błąd
  `createRenderPipelineAsync` (pusty catch) — pipeline zostaje „w budowie”, osłona Core3D pomija rysunek; Core3D loguje
  go do konsoli (harness: `bledy`). `texture(...).onObjectUpdate()` NIE działa (TextureNode.setup zeruje `updateType`
  bez macierzy uv) — tekstura per obiekt: `HullObjectTextureNode` (`src/3d/hexShips3D.tsl.js`). Ścieżkę próbkowania
  (textureSample / textureLoad) TSL wybiera z tekstury obecnej przy BUDOWIE — tekstury zastępcze z filtrem liniowym,
  osobny obiekt na każde wiązanie (TextureNode skleja wiązania po uuid tekstury). `InstancedMesh` wnosi swój uuid do
  klucza — każdy egzemplarz to osobny NodeBuilder (dla instancji per encja: jeden wspólny InstancedMesh).

- **Pułapki z zadania 13 (efekty addytywne):** `NodeMaterial` z `premultipliedAlpha: true` MNOŻY wyjście przez alfę
  (`setupOutput` → `premultiplyAlpha`), a `ShaderMaterial` w WebGL zmieniał tylko czynniki mieszania (ONE, ONE) — efekt
  piszący `vec4(rgb, max(rgb))` ściemniałby; czynniki jawnie: `blendAddytywnePremul` (`src/3d/tsl/mieszanie.js`).
  `AdditiveBlending` bez premultiplied ma te same czynniki w WebGL r183 i WebGPU. `discard` w WGSL (Tint na D3D12:
  „demote to helper”) NIE kończy wykonania — ciężka pętla po `discard` (raymarch) liczy się dalej; pętlę za flagą (wzór
  plume w `warpPlume3D.js`). Punkty (`gl_PointSize`) → kwady na instancjach, rozmiar w px przez `viewportSize`.
  Błąd pipeline'u z pierwszej klatki gry (przed pierwszą sceną harnessu) — w dzienniku startu sesji `zrzuty.mjs`
  (od zadania 23).

- **TSL — pułapki sprawdzone w zadaniach 02, 06–09:** (1) funkcja z `setLayout` musi być CZYSTA — three buforuje jej kod globalnie
  (klasa buildera → węzeł `Fn`), więc uniform / tekstura złapane w domknięciu wskazują w drugim materiale cudzy slot;
  uniformy jako parametry funkcji albo funkcja wklejana (bez layoutu) — wzór `HaloFn` / `haloRingTSL(u)` w
  `src/3d/haloRing/haloRingTSL.js`; (2) najwyżej **12 buforów uniformów na etap** (`maxUniformBuffersPerShaderStage`,
  także w adapterze RTX 5080): `uniform()` z domyślnej grupy dzielą jeden bufor, ale każdy `uniformArray` i każda własna
  grupa to osobny — wiele tablic = blok `createUniformBlock` (`src/3d/haloRing/haloUniformsAdapter.js`) ze stałą nazwą
  (`setName`, inaczej każdy egzemplarz to inny WGSL i osobna kompilacja); (3) `pow` z ujemną podstawą to NaN w WGSL (FXC w bazie WebGL liczył potęgi całkowite mnożeniem) —
  potęgi całkowite mnożeniem; (4) WGSL próbkuje v = 0 z GÓRNEGO wiersza celu — mapę do `texture(map, (u, v))` piecz z
  v = 0 u góry (uv jak `QuadMesh`), wtedy odczyt CPU (`readRenderTargetPixelsAsync`: wiersz 0 = góra, wiersze wyrównane
  do 256 B) nie wymaga odwracania; (5) WGSL budujesz w Node bez GPU (`renderer.backend.createNodeBuilder`, wzór w
  `tests/haloRingTSL.test.mjs`) — testy czytają wygenerowany kod; (6) `smoothstep` ze STAŁYMI krawędziami low ≥ high to
  błąd tworzenia shadera WGSL (GLSL ringu ma ich dziesiątki: `smoothstep(0.34, 0.05, x)`) — odwrócone krawędzie przez
  `haloSmooth(e0, e1, x)` (`haloRingTSL.js`, wzór jak HLSL); (7) `texture(tex)` bez uv ma `updateMatrix = true`, a klony
  z `.sample(uv)` to dziedziczą — każde próbkowanie mnoży uv przez macierz tekstury (osobny uniform mat3 w grupie obiektu,
  aktualizowany co obiekt); węzeł bazowy z uv-atrapą `texture(tex, vec2(0))` (wzór `surfaceTextureNode` w
  `haloRingTerrain.js`); (8) `screenCoordinate` liczy y od GÓRY celu — wzory z pozycji piksela (dither IGN) wychodzą
  odbite względem `gl_FragCoord` bazy WebGL; `haloFragCoordGL()` daje ten sam piksel co WebGL; (9) varyingi z własnego
  `vertexNode`: `varyingProperty(typ, nazwa).assign(…)` w funkcji wierzchołków, ten sam węzeł we fragmencie; (10) baza
  WebGL (ANGLE/FXC) liczy `a·b + c` jednym zaokrągleniem (FMA), Dawn/DXC dwoma — gdy wynik idzie do haszu (wejście
  niecałkowite), 1 ULP zmienia hasz; dla całkowitego `a` i stałej `b` → `haloFusedMulAddInt(a, b, c)` (`haloRingTSL.js`,
  bit w bit z WebGL); sprawdzanie: wiersze haszy w `scripts/webgpu/ring-tsl-parzystosc.mjs`; (11) `PassTextureNode` (np.
  `bloom.getTextureNode()`) gubi `uvNode` w `clone()` — odczyt z UV i poziomem przez `texture(węzeł, uv, poziom)`, nie
  `.sample(uv).level(0)` (drugi klon wraca do domyślnego UV; zadanie 02, `postGry.js`); (12) baza NIE zawsze scala
  `a·b + c`, a decyzja zależy nawet od kodu obok (zadanie 08): w `vec2(x, y) + s·k` składnik x ma dwa zaokrąglenia, y jedno,
  `s / 23 + l · 0,37` — dwa; wariant wybieraj POMIAREM (wiersz parzystości GLSL ↔ TSL z dokładnym wyrażeniem to wskazówka,
  rozstrzyga porównanie zrzutów z bazą), nie z góry przez `haloFusedMulAddInt`; (13) ShaderMaterial w bazie miał
  `forceSinglePass = true` — przenosząc przezroczysty `DoubleSide` na NodeMaterial, ustaw `forceSinglePass: true` (inaczej
  three rysuje tył i przód osobno); (14) `a·b + c` z jednym zaokrągleniem dla DOWOLNEGO `a` (zadanie 09): `haloFma(a, b, c)`
  / `haloFmaV2` (`haloRingTSL.js`) = wbudowane `fma()` WGSL (Tint → HLSL `mad` → DXC — ten sam rozkaz, na który FXC składał
  GLSL w bazie; na GPU bit w bit, `ring-tsl-parzystosc.mjs` wiersze `*FmaWgsl`); TSL r183 nie ma `fma`, stąd `wgslFn`
  (czysta funkcja — uzasadniony wyjątek). Kolejność argumentów = który iloczyn baza scaliła — z pomiaru; (15) pochodne
  (`fwidth`) licz PRZED gałęziami: FXC w bazie spłaszczał gałęzie z pochodnymi, a w WGSL pochodna w rozbieżnej gałęzi jest
  nieokreślona; (16) wczesne `return` w `vertexNode` nie istnieje (main zwraca strukturę varyingów) — zagnieżdżone `If`
  z domyślnym wierzchołkiem `vec4(2, 2, 2, 1)` (poza bryłą obcinania) zachowują oszczędność dawnych `collapse(); return;`;
  `cond.select(a, b)` TSL i tak buduje jako `if / else`.

- **Pułapki r183 z zadania 16 (cienie, cięcie, stan renderu):** (17) goły `NodeMaterial` na meshu z `castShadow` musi mieć
  `map = null` (i `alphaMap = null`): pass cienia (`Renderer._getShadowNodes`) bierze `material.map !== null` za mapę —
  `undefined` daje `texture(undefined)` i błąd budowy cienia (tak padał zamiennik `ShaderMaterial` rzucający cień);
  (18) `material.clippingPlanes` WebGPURenderer ignoruje, a `ClippingGroup` wkłada płaszczyzny do `uniformArray` grupy
  „render” z kontekstu obiektu, który ZBUDOWAŁ program — grupy o tym samym kluczu materiału i liczbie płaszczyzn tną się
  płaszczyznami pierwszej; cięcie per obiekt = maska TSL (`maskNode`, płaszczyzny per obiekt w `onObjectUpdate`, wzór
  `_getShellClipNodes` w `destruction3D.js`); (19) węzły passa cienia powstają PER OBIEKT materiału z `map`
  (`reference('map', …, material)`), więc każdy świeży klon = budowa NodeBuildera cienia w klatce użycia — klon z tą samą
  mapą może dostać wpis oryginału (`_shareShadowNodes`, pola prywatne three, z osłoną); (20) zwykłe `compileAsync` nie
  rozgrzewa passa cienia — `Core3D.prewarmShadowPass(obiekt)` / rejestr z `shadow: true` (zadanie 25a: cel mapy cienia, kamera
  cienia, materiał zastępczy cienia, głębokość wywołania 1 — pułapka 32); trzymacz w scenie na warstwie 31 przez 2 klatki
  to już tylko zapas (`fallback` wpisu); (21) przezroczyste `DoubleSide` bez `forceSinglePass`: WebGPU rysuje WSZYSTKIE tyły, potem
  wszystkie przody (`_renderTransparents`), WebGL tył + przód obiekt po obiekcie — nakładające się siatki mieszają się w innej
  kolejności (wygaszenie bryły stacji, 5 klatek); (22) `vertexColors: true` bez atrybutu `color`: WebGL mnożył przez stałą
  wartość atrybutu (0, 0, 0, 1) = czerń, WebGPU pomija vertexColors (biel); (23) ShadowNode three r183 odświeża mapę cienia
  najwyżej raz na klatkę rAF ze WSZYSTKIMI warstwami kamery cienia — łapacz cienia warstwy 0 (`Core3D.shadowCatcher`, z = −2)
  dostawał cień obiektów FG (stacje: cień bryły-ducha nad planetą po rozpadzie), a drugi widok podzielonego ekranu mapę z
  kamery pierwszego; w WebGL mapa każdego passa miała tylko warstwy kamery passa (`WebGLShadowMap`). Naprawione w Core3D
  (zadanie 23): własny `PassShadowNode` słońca, odświeżenie przed passem ortho (warstwa 0) i FG (warstwa 2 + trzymacze 31)
  z warstwami passa — nowe światło z cieniem zgłaszaj przez `Core3D.setSunShadowLight`.

- **Pułapki TSL z zadania 10 (hala K-7, ringi-archetypy):** (24) wiele siatek jednego materiału (partie, dzielnice) —
  `Mesh` z `InstancedBufferGeometry`, nie `InstancedMesh` (jego uuid wchodzi do klucza programu: osobny NodeBuilder na
  siatkę; ~100 partii ringu Fable); (25) `uniformArray` dostaje nazwę bufora z id węzła (`NodeBuffer_<id>`) — różne
  egzemplarze grafu (trzy ringi, przebudowa jakości) dają różny WGSL i osobne moduły; `.setName('stała')` = wspólny kod;
  (26) `dFdy` TSL generuje `-dpdy` (oś y jak w GL) — dla `textureGrad` bez znaczenia, w formułach ze znakiem pamiętaj;
  (27) wiersz parzystości GLSL ↔ TSL buduj na wejściach jak w materiale: FXC zwija stałe (`(x − 200) + 3,7` → `x − 196,3`),
  więc syntetyczne przesunięcie potrafi zmienić zaokrąglenia (kratka paneli 57% zamiast 100%).

- **Pułapki r183 z zadania 11 (tło menu, rozgrzewka):** (28) tekstura z `minFilter = LinearFilter` i domyślnym
  `generateMipmaps = true`: WebGL próbkuje SAM poziom 0 (dwuliniowo), a WebGPU three i tak generuje mipmapy
  (`Textures.needsMipmaps` patrzy tylko na `generateMipmaps`) i daje samplerowi `mipmapFilter: 'linear'` — próbka z
  pochodnymi jest trójliniowa (mgławica w tle menu: rozmyte włókna, 0,2% kadru > 8/255); parzystość z bazą —
  `texture(…).level(0)` w materiale (albo `generateMipmaps = false` u właściciela tekstury); (29) zmienna TSL (`.toVar()`)
  powstaje w WGSL w miejscu PIERWSZEGO użycia — pochodne (`dFdx`) policzone „przed” gałęzią, a użyte tylko w niej,
  lądują w rozbieżnej gałęzi; przed `If` wymusza je jawne przypisanie (`const g = vec2(0).toVar(); g.assign(dFdx(uv))`);
  (30) `compileAsync` bierze do klucza pipeline'u głębię i szablon RENDERERA (`renderer.depth` / `stencil`), a zwykły
  render — CELU (`depthBuffer` / `stencilBuffer`): rozgrzewka na celu bez głębi (pieczenie map i detalu ringu, maska
  słońca, DIST) dawała pipeline z Depth24Plus, a pierwszy rysunek tworzył drugi — synchronicznie. Każde `compileAsync`
  na celu → `compileAsyncNaCelu(renderer, …)` (`src/3d/rozgrzewka.js`; pilnuje `tests/rozgrzewka.test.mjs`). (31) `compileAsync` woła `updateBefore` węzłów materiału (`_createObjectPipeline`): kompilacja quada postu RYSUJE passy BloomNode (zagnieżdżony render, ich pipeline’y synchronicznie) — dlatego post rozgrzewa się przy urządzeniu, pod kurtyną; nie wyłączać `updateBeforeType` na czas kompilacji — stan budowy zapamiętałby graf bez tego węzła (bloom przestałby się liczyć).

- **Pułapki r183 z zadania 25a (rozgrzewka stacji i passa cienia):** (32) kontekst renderu = stan załączników celu +
  GŁĘBOKOŚĆ wywołania (`Renderer._callDepth`), a id kontekstu wchodzi do klucza NodeBuildera: mapa cienia rysuje się
  zagnieżdżona w passie sceny (updateBefore węzła cienia odbiorcy — głębokość 1), `compileAsync` bierze głębokość 0 —
  `Core3D.prewarmShadowPass` podaje pierwszemu `_renderContexts.get` głębokość passa cienia (strażnik źródeł three:
  `tests/rozgrzewka.test.mjs`); (33) obiekt renderu passa cienia jest kluczowany (obiekt, materiał ZASTĘPCZY, kontekst,
  światła) — podmiana materiału i geometrii obiektu W MIEJSCU (`_shatterSingle`) zostawia stary stan budowy (programy
  cienia starego materiału), a pipeline dostaje nowy układ geometrii: rozgrzewa go klon starego materiału na nowym układzie
  (Destruction3D `trojkaty-cien`); (34) światło tylko na części warstw (np. dawne latarnie stacji pirackiej na warstwie FG)
  daje inny zestaw świateł (= inny klucz KAŻDEGO materiału) w passach i kamerach bez tej warstwy niż w rozgrzewce kamerą
  wszystkich warstw (`layer: 'all'` — bryły ringu przed podpięciem) — stałe światła sceny na wszystkich warstwach
  (`layers.enableAll`), gaszone intensywnością; pojawienie się / zniknięcie światła w biegu przebudowuje materiały w kadrze.

- **Pułapka r183 z maskowania (2026-10-04):** (35) funkcja z `setLayout` wołająca INNĄ funkcję z `setLayout` daje w kolejnych
  budowach tego samego grafu inną kolejność funkcji w WGSL (kod funkcji w cache three, zależności dopisywane w innym
  momencie) — inny moduł GPU dla tego samego materiału. Funkcje z layoutem płaskie (bez wołania innych z layoutem),
  wołające — wklejane (`Fn` bez `setLayout`; wzór `cloakCellVis` / `cloakNoise` w `src/3d/cloak/cloakTSL.js`, strażnik
  „ten sam graf = ten sam kod” w `tests/hullCloakTSL.test.mjs`).

- **Pułapka r183 z heksów-ekranów (2026-10-05):** (36) wspólny węzeł (np. baza slotu `HullObjectStore`) użyty w etapie
  wierzchołków i w pozycji widoku, której nie czyta fragment (`v_positionView` jako lokalna zmienna na początku main), i
  w dalszym przepływie (warunek widoczności): WGSL dostaje odczyt zmiennej węzła PRZED jej przypisaniem — slot 0 (zera),
  siatka nie rysuje nic, bez żadnego błędu (tak warstwa DIST maskowania nie rysowała od 2026-10-04). Pozycja z WŁASNYM
  węzłem (`objectStoreNodesFor` drugi raz — wariant `cloakDist` w `hexShips3D.tsl.js`); strażnik „zmienne przypisane
  przed użyciem” w `tests/hullCloakTSL.test.mjs` (`useBeforeAssign`). Pusta warstwa / cel — sprawdzaj odczytem celu
  (`readRenderTargetPixelsAsync`), nie po obrazie.

- **Pułapka r183 z pyłu hal (2026-10-07):** (37) wyznacznik macierzy świata siatki wchodzi do klucza pipeline'u (kierunek
  ściany przedniej) — siatka rozgrzana z macierzą jednostkową (wyznacznik +1), a rysowana z odbiciem (wyznacznik −1, np.
  przekształcenie świat gry → scena: y sceny = −y gry) dostaje w grze DRUGI pipeline, kompilowany w klatce (także przy
  `DoubleSide`). Macierz z odbiciem → odwróć oś lokalną geometrii (wzór `GasFieldLayer`, `src/3d/gasField/gasFieldLayer.js`;
  strażnik `tests/hallDust.test.mjs`); skrypty gry liczą takie pipeline'y (`syncPoStarcie`).

- **Pułapka r183 z uuid węzłów (2026-10-09):** (38) three skleja węzły w budowie programu PO UUID — `Node.getShared`
  (domyślne `getHash` = `uuid`) i `UniformNode.generate` (`getUniformHash`; w TextureNode uuid TEKSTURY) czytają jeden
  słownik buildera `hashNodes` — a uuid to 4 × `Math.random`. Gdy `Math.random` wraca do stanu sprzed (harness: `reseed`
  ziarnem startu strony albo tym samym ziarnem drugi raz, w trybie wspólnych UUID — `wybuchy-demo.mjs`,
  `wybuchy-sonda.mjs`), węzeł zbudowany po nim dostaje uuid starszego (także singletonów three z importu) i w shaderze
  jego kod — BEZ błędu (sonda gazu: `vec3(f32(instanceIndex))` zamiast uvw, stała 0,5 zamiast przesunięcia slotu) albo
  z błędem budowy cudzego materiału (`PortHullBuild`: `f32 / mat4x4`; „cannot assign to parameter vPbUv”, „Maximum call
  stack … ConditionalNode”) — zależnie od tego, co zdążyło się zbudować przed `reseed`. Łata Core3D
  `src/3d/tsl/uuidWezlow.js` (import zaraz po `three/webgpu`): uuid węzła = uuid three z tych samych 4 losowań + licznik
  (ciąg harnessu i bazy zrzutów bez zmian) oraz strażnik kolizji węzłów / uniformów / tekstur (`Core3D.tslUuid`, raz
  `console.error`, węzeł budowany osobno; `window.__TSL_UUID_NAPRAWA = false` przed wczytaniem — tylko liczy). Światła
  (`AnalyticLightNode`: hasz = uuid światła) i `InstancedMesh` (uuid w kluczu obiektu renderu) bez ochrony — w harnessie
  nie `reseed` ziarnem startu ani dwa razy tym samym (harness ostrzega) albo `osobneLosowanieUuid`. W grze bez harnessu
  uuid się nie powtarza. Strażnik `tests/tslUuid.test.mjs` (`TSL_UUID_BEZ_LATY=1` — przypadki skażenia padają), A/B
  w przeglądarce `node scripts/webgpu/tsl-uuid-gra.mjs [--tryb demo|gra] [--naprawa 0] [--czekaj 0]`.

- **Pułapka r183 z bitwy w głębi (2026-10-19):** (39) zagnieżdżone `select` POZA `Fn` (np. w `positionNode` złożonym z wyrażeń) budują się jako if / else, a węzeł wspólny dla dwóch gałęzi (szerokość kwadu użyta i w billboardzie, i w kwadzie kierunkowym; `modelViewMatrix` pierwszy raz potrzebny w jednej gałęzi) dostaje wartość tylko w gałęzi, w której zbudował się pierwszy — druga czyta zmienną nieprzypisaną, BEZ błędu (smugi i wiązki bitwy w głębi miały zerową szerokość, błyski z tego samego pierścienia się rysowały). Wierzchołki z rozgałęzieniami: `Fn` z jawnymi zmiennymi przypisanymi przed rozgałęzieniem (`const w = float(0).toVar(); w.assign(…)`), varyingi przez `varyingProperty(…).assign(…)`, wybór rodzaju mnożeniem przez maski 0 / 1 (`step`) zamiast `select` — wzór `buildEventGraph` (`src/3d/warBackdrop/warBackdropTSL.js`). Sprawdzanie: WGSL z Node (wzór w `tests/warBackdrop.test.mjs`) — zmienna przypisana w jednej gałęzi `if`, czytana poza nią.

## Rozgrzewka pipeline'ów (`Core3D.warmup`)

- **Rozgrzewka pipeline'ów (zadanie 11, `src/3d/rozgrzewka.js`, `Core3D.warmup`):** w WebGPU klucz pipeline'u to graf materiału + układ atrybutów + cel (format, próbki, głębia) + światła passa + typ kamery + stan (mieszanie, głębia, strona), więc rozgrzewa się PRAWDZIWE obiekty w PRAWDZIWYM celu. Moduł dopisuje się JEDNĄ linią (przy imporcie też — wpisy czekają na urządzenie, a funkcja `objects` woła się dopiero w chwili rozgrzewki):
  `Core3D.warmup.add({ name: 'moje efekty', objects: () => MojaPula.warmupMeshes(), phase: 'loading' });`
  Każda siatka poddrzewa to osobne zadanie: `compileAsync(siatka, kamera passa jej warstwy, Core3D.scene)` z celem `composerTarget` (warstwa DIST — `distortionTarget`), widoczna i bez cullingu tylko na czas wywołania. Opcje: `layer` (liczba albo `'all'` — obiekty jeszcze poza passem), `camera` (własna), `visible: false` (tylko to, co już widać — przegląd sceny), `variant: { apply(siatka) → przywróć }` (drugi stan materiału, np. przezroczystość), `target` / QuadMesh (pass pełnoekranowy — własna kamera, bez świateł sceny), `split: false` + `override` (cała scena z materiałem zastępczym — pre-pass halo), `alive: () => bool` (właściciel zwolnił obiekty), `phase: 'loading'` (pula, którą `objects()` tworzy — dopiero na ekranie ładowania, jak przy pierwszym użyciu w grze), `phase: 'after'` (w tle PO pierwszym `flush()` — obiekty, których pierwsza klatka gry nie rysuje, np. modele flot przylatujących później; w kolejce ekranu ładowania wypychały za limit 4 s to, co gra rysuje od razu — 2026-10-16: skała planetoidy, baza, niebo kamer 3D, mostki, dysze SIDE), `shadow: true` (pass MAPY CIENIA słońca zamiast passa sceny — siatki z `castShadow` przez `Core3D.prewarmShadowPass`, pułapki 20 i 32; `fallback(siatka)` — gdy ta droga niedostępna). Pilne `now(obiekty, opcje)` → Promise (tło menu, bryły ringu przed podpięciem) idą przed `add`. Praca w tle: `requestIdleCallback`, po jednej siatce (budowa NodeBuilder jest synchroniczna, ~1–95 ms), pipeline'y w tle GPU; `Core3D.warmup.flush()` w `startGame` (po `waitForPlanetsReady`) dokańcza kolejkę i czeka na pipeline'y (limit 4 s). Istniejąca rozgrzewka modułu (funkcja, logika bez zmian) — `Core3D.warmup.run(nazwa, () => …)`: idzie od razu, czas CPU i kompilacje zlecone w trakcie (`prewarmPass`, zwrócona obietnica) liczą się do wpisu, `flush()` czeka na nie; kroki `Core3D.fx` z `warm` idą przez rejestr same (`FxFrame._warmStep` — nowy krok efektów nie potrzebuje nic więcej). Wpisy dziś: post (uber z bloomem i bez — pilnie przy urządzeniu), passy Core3D (w menu: tło, planety, poświaty, ring-planety, pre-pass halo, quady halo i maski słońca; na ekranie ładowania wszystkie passy z tym, co jest w scenie), dysze SIDE (`engineExhaustBatch.js`), światła pozycyjne (`shipLights3D.js`), bryły ringów (hak `prewarm`), tło menu (`warmup.now`); kroki `Core3D.fx`: broń (`weapons`, 17), rakiety i iskry (`rakiety`, `iskry`, 19), warp (`warpNurt`, 22), pas asteroid (`asteroidBelt`, 21), mapa ran (`hullDamageMap`, 18-C), wybuchy (`wybuchy`, 2026-10-07 — puste dispatche kerneli gazu i żaru, siatki odsłonięte z licznikiem instancji ≥ 2, kamera z góry i kamery 3D); `run` w `startGame`: kadłuby i Fx3D (`prewarmHexShips3D`), tarcze (`prewarmShields3D`), start GPU pasa (`asteroidBelt.initGpu`); zadanie 25a: stacje planet (`prepareStations3D` w `startGame` — szablony GLB: pass FG, cień, rozpad; bryły stacji), rozpad stacji (`Destruction3D.prebake` → wpisy `rozpad stacji: …`, pass cienia w tle), pule odłamków paneli, stacja piracka (bryła gotowa z ekranu ładowania, `world3d.js`), smugi dalekich kadłubów (`hexBodyImpostorBatch.js`). Rozgrzewka z samego `warm` kroku `Core3D.fx` (`prewarmPass` przy tworzeniu modułu) w workerze renderu NIE trafiała w klucz prawdziwego rysunku (bryły gazu wybuchów: pierwsza domena atlasu budowała je w klatce, 130–370 ms na bryłę) — siatki pul efektów dopisuj też do rejestru: `Core3D.warmup.add({ objects, phase: 'loading', variant: WARIANT_INSTANCJI })` (+ `ortho: false`; `WARIANT_INSTANCJI` z `rozgrzewka.js` — licznik instancji ≥ 2 na czas kompilacji); w grze ciężkie kompilacje rejestru po `flush()` ostrzegają w konsoli (`[Core3D.warmup] kompilacja w grze`), lista `Core3D.warmup.stats.ciezkie`. Kernele compute rozgrzewają kroki `Core3D.fx` pustymi dispatchami — pipeline compute three r183 powstaje SYNCHRONICZNIE (ekran ładowania); osłony jak dla rysunków nie ma: `warm` kroków robi też prawdziwą pracę (np. inicjalizacja drobin ośrodka warpa), pominięty dispatch zostawiłby dane bez inicjalizacji. Każde `compileAsync` na celu przez `compileAsyncNaCelu` (pułapka 30). Pomiar: `Core3D.warmup.stats` (`flush` — czas ekranu ładowania w rejestrze, `grupy` — CPU po modułach), przestoje klatek — harness (`wyniki.json`: `przestoje` scen, `sesje`), start w prawdziwym czasie — `scripts/webgpu/start-gry.mjs [--root <worktree tagu>]`; oba liczą pipeline'y utworzone SYNCHRONICZNIE (`pipeline.sync`, `syncLista` = „materiał @ obiekt” — to, czego nikt nie rozgrzał; przestój przychodzi zwykle klatkę później, przy zapisie do kolejki). „Przed” tym samym harnessem: `zrzuty.mjs --root <eksport main>`. `Core3D.prewarmPass` zostaje dla modułów, które przełączają widoczność wokół wywołania (projekcja synchroniczna, cały pass naraz).

## Moduły 3D — zasady pisania (`world3d.js`, `stations3D.js`, `hexShips3D.js` i reszta `src/3d`)

- Używaj `Core3D.scene` i `Core3D.camera`.
- Stan gry (gracz, kamera, Słońce, listy, opcje, haki dev i nastawy harnessu) czytaj przez fasadę `RenderWorld` (`src/render/renderWorld.js`: `RenderWorld.ship`, `.camera`, `.sun`, `.options`, `.config.*`, rozgrywka mieszkająca jeszcze w renderze — `.game.*`), nigdy `window.<zmienna gry>` ani `GameState` — render ma działać w workerze (`docs/PLAN-render-worker.md`, RW-12); strażnik `tests/szewRenderu.test.mjs` (`okno:`, `okno-wartosc:`, `gamestate:` = 0). Brakuje pola — dopisz getter w fasadzie (tryb `off` czyta dzisiejszy global). Bez DOM (RW-35, `dom:` = 0): kanwy i obrazy przez `src/3d/canvas2d.js` (`createCanvas2D` — OffscreenCanvas, `loadTexture` / `loadImageBitmap` zamiast `TextureLoader` / `new Image`), praca w tle i klatka przez `src/3d/harmonogram.js` (`requestIdle`, `requestFrame`), rozmiar okna, DPR, widoczność karty, `localStorage` i adres strony przez `RenderWorld` (`viewWidth`, `devicePixelRatio`, `pageHidden`, `storageItem`, `pageSearch`).
- Nie twórz lokalnych rendererów, urządzeń GPU ani dodatkowych kanw 3D — wszystko rysuje `Core3D` (dawny wyjątek — solver sprężyn heksów `destructorGpuSoftBody*` z własnym `GPUDevice`, PLAN §11 — usunięty z silnikiem heksów 2026-10-19). Materiały i shadery tylko w TSL (§ „Render: WebGPU + TSL”).
- Świat leży przy 5–10 mln j.: pozycja świata liczona na GPU we float32 drga ~1 px względem kadłubów. Nie wpisuj bezwzględnych pozycji do macierzy instancji ani atrybutów — duży offset w `mesh.position` (`renderer.highPrecision = true`: three składa `modelViewMatrix` na CPU w double), dane względem niego, w grafie TSL węzeł `modelViewMatrix` (ręczne `cameraViewMatrix.mul(modelWorldMatrix)` omija `highPrecision` — PLAN §4); `positionWorld` we fragmencie to float32 (pas asteroid czyta pozycje lokalne). Wzór: `Bridge3D._setOrigin` (`docs/PORT-mostki.md` §8.12).
- Początek przy kamerze daje `sceneOriginNearCamera` (`src/3d/sceneOrigin.js`); dane przepisywane co klatkę — początek co klatkę (np. `shipLights3D.js`, `fxParticles3D.js`), bufor pisany raz przy emisji (pierścień) — początek „lepki” z przesunięciem żywych danych dopiero po odjeździe kamery (`sparkSystem3D.js`; pule GPU: `FxPoolOrigin` + kernel przesunięcia w `src/3d/fx/gpuPoolOrigin.js`, np. efekty broni). Pozycje świata w pulach CPU: `Float64Array`. Pomiar drżenia przed/po w grze: `scripts/webgpu/drzenie-gra.mjs` (bloom wyłącza `perfToggles.bloom = false` — post czyta go w każdym renderze).
- Moduł, który sam rzutuje świat na piksele kadru (źródła zniekształceń, pudła i culling CPU, soczewki, pozycje
  w px dla shadera), liczy z obrotem kadru `cam.roll` (`src/3d/viewRoll.js`: przesunięcia przez `rollToScreen` /
  `rollToWorld`, pudło kadru przez `rolledHalfExtents`) — inaczej przy obróconej kamerze (demo `warp-ped`: skok kursem
  w górę) efekt ląduje obok obiektu albo znika przy brzegu. Kamery three obraca Core3D (§ „Core3D”, OBRÓT KADRU).

- Przezroczysty materiał z `side: DoubleSide` bez `forceSinglePass` three rysuje DWA razy — w WebGPU najpierw WSZYSTKIE tyły, potem wszystkie przody (pułapka 21), więc nakładające się siatki mieszają się inaczej niż obiekt po obiekcie, a każdy obiekt kosztuje drugi rysunek. Materiał węzłowy nie ma `forceSinglePass` z urzędu (dawny `ShaderMaterial` miał): efekty addytywne bez zapisu głębi i płaskie przezroczyste siatki dostają `forceSinglePass: true` (pociski, błyski, wiązki, chmury ringu).
