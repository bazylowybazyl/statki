# AGENTS.md — aktualny przewodnik dla agentów

> **Cel pliku**: krótki, praktyczny opis aktualnej architektury gry „Super Capital: Battle for Solar System” i miejsc integracji. Trzymaj się tych zasad, żeby nie psuć gameplayu i wydajności.

---

## Szybka mapa repozytorium

- **`index.html`** — główna pętla gry i warstwa **2D Canvas** (sterowanie, fizyka, strzały, HUD, UI).
- **`src/3d/core3d.js`** — **jedyny współdzielony rdzeń renderu 3D**: `WebGPURenderer` (`three/webgpu`), `scene`, kamery, passy scen do `composerTarget`, post jako `RenderPipeline` (TSL). Wspólne pomocniki TSL: `src/3d/tsl/`.
- **`src/3d/hexShips3D.js`** — aktualizacja i render statków/hexów 3D; końcowe wywołanie renderu 3D (`Core3D.render()`) i kopiowanie na 2D.
- **`src/3d/world3d.js`** — obiekty świata 3D (np. piracka stacja), podpinane do `Core3D.scene`.
- **`src/3d/stations3D.js`** — stacje 3D, podpinane do `Core3D.scene`.
- **`planet3d.assets.js`** — aktywna warstwa planet/słońca (API globalne: `initPlanets3D`, `updatePlanets3D`, `drawPlanets3D`).
- **`planet3d.proc.js`** — wariant legacy/proceduralny (nie używać jako głównej ścieżki bez wyraźnej potrzeby).
- **`src/3d/haloRing/`** — ring „Halo” Ziemi i Marsa (teren, miasta, megastruktura, port K-7); klej gry `haloRingGame.js`, kolizje `src/game/haloRingCollision.js`. Opis: `docs/PORT-halo-ring.md`.
- **`src/game/hullBodies.js`** — kadłuby statków, NPC i wraków na silniku belek (`src/game/destructorBeams3D.js`, tryb płaski): budowa ze sprite'a, synchronizacja ruchu, trafienia, wraki. Opis: `docs/PORT-silnik-belek.md`.
- **`src/game/destructor.js`** — stary silnik heksów; dziś już tylko asteroidy (do portu skał na belki).
- **`src/game/shipEntity.js`** — konfiguracja i geometria statku gracza (fizyka wejścia, offsety, thrusters, hardpointy).
- **`package.json`** — serwer dev i zależności.

---

## Pipeline renderowania (aktualny)

1. **Gameplay i fizyka** dzieją się w 2D (`index.html`, `destructor.js`, logika broni/NPC/HUD).
2. W `render(alpha, frameDt)` aktualizowane są moduły 3D:
   - `WarpNurt.update(…)` (warp „Nurt”: ośrodek, bańki, szczeliny, gwiazdy i mgławica skoku — przed planetami)
   - `updatePlanets3D(frameDt, cam)`
   - `haloRings.update(frameDt, cam, …)` (ring „Halo”)
   - `updateStations3D(stations)`
   - `updateWorld3D(frameDt, vfxTime)`
   - `updateHexShips3D(cam, hexEntities)`
3. Finalna klatka 3D (kanwa WebGPU `#webgl-layer`) jest kopiowana na główny canvas przez `drawHexShips3D(ctx, W, H)` — w TYM SAMYM zadaniu JS co render (po `await` kanwa WebGPU bywa pusta). Podzielony ekran = 2× `Core3D.renderSingle` + wycinki (jeden render z nożyczkami nie istnieje: `clear()` w WebGPU czyści cały cel).
4. HUD/overlays 2D są rysowane na końcu.

**Zasada żelazna**: _Nie twórz nowych rendererów (`WebGPURenderer`, `WebGLRenderer`) poza `Core3D`._ Wyjątek przejściowy: overlay efektów (`src/effects3d/overlay.js`) do zadania 20 portu.

---

## Port WebGPU (w toku)

Plan: `docs/webgpu/PLAN.md`; stan zadań i dziennik: `docs/webgpu/POSTEP.md`; jak prowadzić zadania: `docs/webgpu/README.md`.

- **Jedna ścieżka (decyzja użytkownika 2026-09-27):** od zadania 01 `Core3D` ma tylko `WebGPURenderer` (`three/webgpu`),
  bez flagi wyboru backendu. Stary `WebGLRenderer` zostaje wyłącznie w tagu `webgl-baseline` (baza porównań, dema spoza
  portu). Praca na `main`.
- **GLSL usuwamy:** zadanie, które przenosi moduł, kasuje jego GLSL w tym samym commicie. **Nowego GLSL ani
  `ShaderMaterial` nie piszemy** — nowy kod renderu tylko w TSL (`three/tsl`, materiały węzłowe), wspólne pomocniki w
  `src/3d/tsl/`. Konwencje (adapter `material.uniforms`, graf węzłów współdzielony zamiast materiału na encję, rozgrzewka
  passów, światła, precyzja): `PLAN.md` §3–§6.
- **Magenta = nieprzeniesiony materiał.** Każdy `ShaderMaterial` bez portu rysuje się magentowym zamiennikiem (licznik
  w harnessie) — to stan przejściowy, nie błąd do obchodzenia. Overlay efektów (`src/effects3d/overlay.js`) do zadania 20
  zostaje na własnym `WebGLRenderer` (jedyny wyjątek od zasady żelaznej).
- **Core3D na WebGPU (zadanie 01):** tylko WebGPU — przed rendererem `navigator.gpu.requestAdapter()`, bez adaptera
  renderer nie powstaje, `Core3D.ready` → `false`, menu pokazuje „Gra wymaga przeglądarki z WebGPU” (bez zapasu WebGL2:
  `_getFallback = null`). `init()` jest synchroniczne jak dawniej (scena, kamery, cele → `isInitialized`), urządzenie
  powstaje w tle: `Core3D.gpuReady` / `Core3D.ready` bramkują render, kompilację i wgrywanie tekstur, a
  `Core3D.renderer` istnieje dopiero przy gotowym urządzeniu. Limity z adaptera (`GPU_REQUIRED_LIMITS`),
  `highPrecision = true`, wyjście liniowe bez tone mappingu (ACES gry i sRGB w poście, `src/3d/tsl/kolorGry.js`,
  `outputColorTransform = false`). Zamiennik: `src/3d/tsl/zamiennik.js`; adapter `material.uniforms`:
  `src/3d/tsl/uniformy.js`. Anizotropia tekstur: `Core3D.getMaxAnisotropy()` (WebGPURenderer nie ma `capabilities`).
- **Kompilacja w WebGPU:** `renderer.compile` to alias `compileAsync` — zamiast niego `Core3D.prewarmPass(obiekt,
  warstwa)` (cel `composerTarget`, kamera passa z warstwą, bez cullingu; nie blokuje). three r183: pipeline z
  `compileAsync` siedzi w cache, zanim GPU go odda — zwykły draw tego samego klucza wołał `setPipeline(undefined)`;
  Core3D osłania `backend.draw` (`_guardPendingPipelines`: taki rysunek czeka klatkę, dwie). `renderer.info`: draw calle
  w `render.drawCalls` (reset raz na klatkę rAF). Zegar GPU: znaczniki czasu (`trackTimestamp`), jedno zapytanie w
  locie → `Core3D.gpuFrameMs`; mapa `timestamps` puli three nie jest czyszczona przez three — Core3D czyści ją po wyniku.
  **Pierwszy rysunek materiału bez rozgrzewki = przestój:** zwykły render tworzy pipeline SYNCHRONICZNIE
  (`createRenderPipeline`) — proces GPU kompiluje shader, a strona staje na nim przy najbliższym zapisie do kolejki
  (w profilu wygląda to jak wielosekundowy `writeBuffer`: pierwsza klatka ringu w menu stała 4–5,6 s); `compileAsync`
  robi to w tle (cały ring Marsa: 0,14 s CPU, klatki bez przestoju). Nowy obiekt z nowym materiałem → rejestr
  rozgrzewki `Core3D.warmup` (§ „Rozgrzewka pipeline'ów” niżej, przy menu).
- **Pułapki TSL z zadania 04** (reszta — w notce „TSL — pułapki sprawdzone w zadaniach 02, 06–09” niżej): **najwyżej 8
  buforów wierzchołków na pipeline** (`maxVertexBuffers` = 8 także w adapterze RTX 5080) — każdy nieprzeplatany atrybut
  to bufor, InstancedMesh dokłada macierz instancji (+ normalne); stałe atrybuty przeplataj, a materiał liczący pozycję
  sam (`vertexNode`) na InstancedMesh nadpisuje `setupPosition` (wzór `HullDebrisNodeMaterial`). three połyka błąd
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
  `zrzuty.mjs` zbiera błędy per scena — błąd pipeline'u z pierwszej klatki gry (przed pierwszą sceną) nie trafia do
  `bledy`; `scripts/webgpu/silniki.mjs` wypisuje „start gry”.
- **Post (zadanie 02, `src/3d/tsl/postGry.js`):** kolejność jak dawny łańcuch resolve → bloom → uber. Bloom =
  `BloomGry` (BloomNode three, ten sam algorytm co dawny pass WebGL; BloomNode r183 nie ma ×3 kompozytu —
  `BLOOM_ZGODNOSC_WEBGL = 3`, alfa = max(rgb) bloomu jak przy dawnym blendzie; liczony raz na RENDER, bo podzielony ekran to
  dwa `renderSingle` w klatce; rozmiar = bufor rysowania × `resolutionScale`). „Uber” próbkuje scenę i bloom tym samym
  przesuniętym UV (gorące powietrze do 24 źródeł, dyspersja dysz), potem ACES gry i sRGB. Dwa `RenderPipeline` zbudowane
  raz: z bloomem i bez (`perfToggles.bloom`, czytane w każdym renderze), gorące powietrze = uniform `uHeatOn` — przełączniki
  bez przebudowy. Strojenie bloomu = uniformy węzła (`_applyBloomPassConfig` co klatkę, tuner `?dev`). Kubełek `bloom`
  mierzą haki BloomGry (jego passy lecą w środku renderu postu), `post` = sam uber. Znaczniki czasu GPU: brama na granicy
  klatki (`_gpuTimerGate`) — pula three (2048 zapytań) nie przepełnia się przy wolnym wyniku.
- **Maska słońca, SDF kadłubów, refrakcja (zadanie 03):** pass maski = `QuadMesh` + NodeMaterial (`createShadowShaftsPass`
  w `core3d.js`, marsz po SDF — `hullSdfShadow` w `hullShadowSdf.js`); materiały czytają maskę funkcjami TSL z
  `sunShadowMask.js` po **`screenUV`** (rozmiar AKTUALNEGO celu — cel w innej rozdzielczości trafia sam, bez teksela).
  Cele pomocnicze, do których rysują materiały SCENY (halo), mają format / typ / MSAA /
  głębię `composerTarget`: three buduje materiały (NodeBuilder) i pipeline'y per KONTEKST renderu, a kontekst to stan
  załączników celu — inny format = budowa wszystkiego w kadrze na zimno przy pierwszym użyciu. Tablice warstw
  (`DataArrayTexture`): three r183 w WebGPU ignoruje `layerUpdates` i na `needsUpdate` wgrywa całą tablicę (SDF
  kadłubów 4 MB, ~3 ms CPU) — jedna warstwa przez `Core3D.uploadTextureLayer` (hak `HullShadowSdf.layerUploader`).
  Parzystość maski z bazą WebGL w grze: `scripts/webgpu/maska-slonca.mjs --root <worktree tagu>`. Fala z refrakcją
  (`shockwave3D.js`, snapshot sceny) usunięta w zadaniu 19 — fale idą przez zniekształcenia efektów. Gorące powietrze w podzielonym ekranie ma tylko widok gracza 1 (źródła w UV
  kamery gracza 1; na WebGL widok 1 miał je przesunięte, widok 2 — żadnych).
- **Infrastruktura efektów GPU (zadanie 12, `src/3d/fx/`, opis `docs/webgpu/FX-INFRA.md`)** — `Core3D.fx` (`fxFrame.js`)
  raz na klatkę rAF na starcie `render()`, przed passami (podzielony ekran: drugi `renderSingle` nic nie robi): kroki
  `Core3D.addFxStep({ name, spawn?(ctx), lights?(ctx), update?(ctx), warm?(ctx) })` → początek pul przy kamerze i zegary
  (`ctx.origin` = `FxPoolOrigin`; **pula GPU MUSI się w nim zarejestrować** z kernelem `createShiftKernel`, inaczej początek
  przestawia się pod jej danymi) → siatka świateł → update. Zegar efektów `ctx.time` / `Core3D.fx.time` biegnie z klatką
  rAF jak `Fx3D.time` (krok ≤ 0,1 s, także w pauzie). `warm` idzie raz przy gotowym urządzeniu: puste dispatche kerneli +
  `Core3D.prewarmPass(siatka, warstwa)`. **Siatka świateł** (`Core3D.fx.grid`): `renderer.lighting = GridLighting` w trybie
  „optIn”, ustawiony PRZED `renderer.init()` (three r183 łapie `lighting` w init — podmiana później nic nie zmienia);
  czytają ją tylko materiały z `gridLights = true` (`enableGridLights(mat, owner)`) — reszta ma WGSL i obraz bez zmian.
  Światła efektów: `Core3D.fx.lights.flash(...)` / `.point(...)` (świat gry, nośnik z `ActiveCarrier`), własne światła kroku
  w `lights(ctx)` przez `ctx.grid.addWorld(...)`. **Zniekształcenia** („uber”, gałąź tylko przy źródłach): fala / implozja /
  gorące powietrze — `Core3D.fxDistortion().shock / implode / heat(...)` (świat gry, co klatkę przed renderem; dysze i
  tarcze zostają przy `pushHeatHazeWorld`); warstwa DIST — siatki na `FX_DISTORT_LAYER` (10) piszą przesunięcie w px (osie
  sceny, RG) do `Core3D.distortionTarget`, właściciel co klatkę `Core3D.setDistortLayerActive(bool)`. Przed bloomem i w
  odczytach sceny „uber” — siatka bezpieczeństwa NaN / ±Inf → 0 (`hdrBezpieczny`, `postGry.js`). Pomiar: `Core3D.fxStats`
  (PerfHUD „Efekty GPU”), kontrola na GPU: `scripts/webgpu/efekty-kontrola.mjs`. Bank `Fx3D` (`fxParticles3D.js`) w TSL:
  cztery grafy (BB, PLUME, CROSS, WASH) wspólne dla systemów, tekstura per obiekt (`FxMapNode`).
- **Zniszczenie stacji (zadanie 16, `src/vfx/`):** rozpad na trójkąty i implozja = dwa grafy TSL w `shatterMaterial.js`
  (budowane raz, lekki `ShatterNodeMaterial` per mesh, wartości w `material.uniforms` przez `onObjectUpdate`, mapa per obiekt
  `teksturaObiektu` z `src/3d/tsl/`); wierzchołki w `vertexNode`, więc pass cienia rysuje nieprzesuniętą bryłę jak dawny
  `MeshDepthMaterial`. Kawałki skorupy po `detachChunk` tną się **maską TSL** (`maskNode` klonów, płaszczyzny per obiekt
  rzutowane do widoku — ta sama reguła co `material.clippingPlanes` w WebGL), nie `ClippingGroup` (pułapka 18). Klony
  materiałów GLB (wygaszenie bryły, kawałki) dostają węzły cienia oryginału (`_shareShadowNodes`). Rozgrzewka przy
  `Destruction3D.prebake` (bryła stacji powstała): trójkąty, implozja, wygaszenie, kawałki — `prewarmPass` na trzymaczach z
  układem geometrii bryły; pass cienia — trzymacze na warstwie 31 przez 2 klatki; pule odłamków paneli —
  `PanelShardManager.prewarm`. Klatka rozpadu bez budowy materiałów (`scripts/webgpu/rozpad-stacji.mjs`). Odłamki paneli są
  CZARNE jak w WebGL (pułapka 22) — barwy z `instanceColor` to decyzja wyglądu (kolor pul 0xffffff). Scena bazy
  `stacja-rozpad` (sesja „stacja”, warianty `__3d` / `__fg-3d` bez overlaya); różnice na sylwetkach vs wnętrza:
  `scripts/webgpu/krawedzie.mjs`.
- **Nowe efekty broni i rakiet z dem** (`dema/bronie-webgpu`, `dema/rakiety-webgpu` — decyzja użytkownika 2026-09-27)
  zastępują stare (zadania 12, 17–20); wspólne klocki w `src/3d/fx/`. Broń (zadanie 17): `src/3d/weapons/` — § „Efekty broni” niżej. Starych efektów broni, rakiet, iskier i trafień nie
  przenosimy 1:1 ani nie poprawiamy — idą do wymiany. Rozgrywka zostaje w grze: dema dostają tylko zdarzenia (strzał,
  lot, trafienie).
- **Rakiety (zadanie 19, `src/3d/rockets/`, opis `docs/webgpu/DEMO-RAKIETY.md` § Port w grze):** lot, naprowadzanie,
  trafienia i obrażenia zostają w `rocketSystem3D.js`; wygląd z dema `rakiety-webgpu` to reżyser `RocketEffects`
  (`effects.js`) na zdarzeniach lotu (`onLaunch / onIgnite / onFly / prepareContact / onDetonate / update`) i krok efektów
  „rakiety” (`rocketFx.js`): dym compute (mapa gęstości, samocień, światło z siatki, siła śladu tylko w dymie > 0,8 s),
  płomienie, kadłubki (słońce × `sunVisibility` + siatka), kule ognia, łuki, mgławica Supernowej, duszki, światła →
  `grid.addWorld`, fale / implozja / gorące powietrze → `Core3D.fxDistortion()`. Zegar reżysera = suma dt lotu rakiet
  (w pauzie stoi); pozycje w świecie gry (double), do GPU względem `Core3D.fx.origin`. Supernowa przygasza obraz
  i podbija bloom przez `Core3D.fx.post` (exposure = min, bloomBoost = max; FxFrame kasuje co klatkę). Losowość efektów
  z fxRandom — `Math.random` gry (wyrzut) bez zmian. **Zero alokacji na klatkę i rakietę:** w pętlach klatki bez liczb
  zmiennoprzecinkowych w argumentach / wyniku wywołań (V8 opakowuje je w obiekty, gdy nie wklei funkcji) — wpisy robocze
  pul (`pool.s` + `push()`), bufor świateł (`stageLights` / `flushLights`), kinematyka rakiet w tablicach (`_kin`),
  liczby losowe `fillRandom` (ten sam ciąg co fxRandom), `Math.sqrt` zamiast `Math.hypot`. Harness: sesja „rakiety”.
- **Stara soczewka warpa i stare asteroidy nie przechodzą** (stare pole **wyłączone** w grze: `OLD_ASTEROIDS_ENABLED`,
  `?asteroidyStare`) — zastępują je nowe z dem WebGPU (`dema/asteroidy-webgpu` → zadanie 21, `dema/warp-webgpu` →
  zadanie 22: warp „Nurt” w grze, opis w „Warp „Nurt”” niżej). Moduły ruchu v2 spoza gry (Z4/Z5/Z7) przechodzą na TSL przy swojej integracji.
- **Weryfikacja:** `node scripts/webgpu/zrzuty.mjs --backend webgpu --out .tmp/webgpu/zadania/NN --baza .tmp/webgpu/baseline/webgl/p1`
  (sceny deterministyczne, porównanie z bazą WebGL, spis zamienników; `--uuid osobne` = UUID three z osobnego strumienia,
  bez tego tysiące węzłów TSL przesuwają `Math.random` gry i świat — planety, wraki, warp — wychodzi inny niż w bazie;
  tryb bierze się z bazy, patrz nagłówek `zrzuty.mjs`); haki `?dev`: `window.DevScene.teleport / syncCamera /
  preloadHullSprites / startSplit`. Testy: `node --test "tests/*.test.mjs"` (wzorzec w cudzysłowie — `tests/` na Node 22
  nie działa).
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
  mapą może dostać wpis oryginału (`_shareShadowNodes`, pola prywatne three, z osłoną); (20) `compileAsync` nie rozgrzewa passa
  cienia — trzymacz w scenie na nieużywanej warstwie (31: kamera cienia słońca ma `layers.enableAll`, żaden pass Core3D
  jej nie rysuje) przez 2 klatki; (21) przezroczyste `DoubleSide` bez `forceSinglePass`: WebGPU rysuje WSZYSTKIE tyły, potem
  wszystkie przody (`_renderTransparents`), WebGL tył + przód obiekt po obiekcie — nakładające się siatki mieszają się w innej
  kolejności (wygaszenie bryły stacji, 5 klatek); (22) `vertexColors: true` bez atrybutu `color`: WebGL mnożył przez stałą
  wartość atrybutu (0, 0, 0, 1) = czerń, WebGPU pomija vertexColors (biel); (23) mapa cienia słońca raz na klatkę ze
  WSZYSTKIMI warstwami — łapacz cienia warstwy 0 (`Core3D.shadowCatcher`, z = −2) dostaje cień obiektów FG (stacje,
  z ≈ −100 ± 300); w WebGL mapa cienia każdego passa miała tylko warstwy kamery passa (`WebGLShadowMap` testuje warstwy
  kamery renderu), więc łapacz 0 cienia stacji nie widział. Widać to po rozpadzie stacji (cień bryły-ducha nad planetą) i
  przy implozji — do decyzji w Core3D (zadanie 23), nie w materiałach.
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
  na celu → `compileAsyncNaCelu(renderer, …)` (`src/3d/rozgrzewka.js`; pilnuje `tests/rozgrzewka.test.mjs`).

---

## Kluczowe byty gry

### Świat i kamera
- `WORLD` — rozmiar mapy.
- `camera` — zoom, limity, tryby śledzenia/focus.
- Zoom: wejście (kółko, pad, ŚPM) ustawia tylko `camera.targetZoom`; `camera.zoom` goni go sprężyną w log(zoom) RAZ NA KLATKĘ renderu (`updateCameraZoom` w `index.html`, `src/game/cameraZoom.js`). Nie krokuj zoomu w `physicsStep` (120 Hz vs 144/165 Hz = klatki bez ruchu, zoom „skacze”) i nie pisz `camera.zoom` wprost z wejścia. Zoom RTS do kursora = kotwica `camera.zoomAnchor`.
- Kamera statku = statek + offset riga w PX EKRANU (`src/game/cameraRig.js`, krok w `render()`): postawa nawigacji (kursor nie rusza kamerą, wyprzedzenie lotu, wolna sprężyna) i walki (kursor z martwą strefą do 0,75 pół ekranu, szybka sprężyna), mieszane wagą walki. Walkę trzymają sygnały: strzał gracza (`WeaponShotBus`), trafienie (`applyDamageToPlayer`; obrażenia spoza walki podają `{ combat: false }`), wrogi cel na namiarze, wróg w zasięgu broni. Opcja `OPTIONS.cameraLook` (Auto/Zawsze/Nigdy), strojenie `cameraRigTune` (F12 → Kamera panel, zapis tylko z `?dev`). Środek statku nigdy bliżej krawędzi niż `frameMargin` — nie dokładaj offsetów kamery poza rigiem. Kursor zajęty UI (menu PPM, koło ŚPM, Alt, tablet, CIC) ZAMRAŻA punkt patrzenia (`isCameraLookFrozen`), nie zeruje go.
- Przejścia kamery (`camera.transition`) kroczy `stepCameraTransition` raz na klatkę w `render()`. Przejście do statku (`kind: 'ship'`) prowadzi tylko pozycję i goni żywy cel riga (koniec bez skoku), zoom zostaje sprężynie; fokus stacji prowadzi zoom sam. Wstrząs (`camera.addShake`, wstrząs strzałów `__weapon3dCameraShake.mag`) liczony w px ekranu gładkim szumem, z sufitem.

### Planety i słońce
- `initPlanets3D(planets, SUN)` — inicjalizacja.
- `updatePlanets3D(dt, cam)` — aktualizacja.
- Planety są częścią wizualnej warstwy 3D, gameplay nadal jest liczony w 2D.
- Halo (poświata limbu) Ziemi i Marsa: `createRingAtmosphere` w `planet3d.assets.js` — płaski dysk w passie ortho z modelem atmosfery z tła menu (cięciwa przez powłokę R + H, gęstość e^(−h/Hs)), gaśnie do zera na brzegu powłoki. Nie wracaj do powłoki-kuli z maską Fresnela: przy 1,21 R dawała kropkowany łuk, przy 1,034 R ~1% jasności (halo znikało).
- Materiały w TSL (port WebGPU, zadanie 05): `src/3d/planet3d.assets.tsl.js`. Graf RAZ na rodzaj (powierzchnia,
  chmury, poświata planet tła i księżyców, poświata limbu, słońce), każde ciało dostaje lekki `PlanetBodyNodeMaterial`
  z tymi samymi węzłami; wartości per ciało w `material.uniforms` (obiekty `{ value }` — kontrakt
  `window.EARTH.uniforms.*Texture.value` / `cloudUniforms` dla tła menu i devTools bez zmian), tekstury per ciało przez
  `PlanetObjectTextureNode`. Mgławica (`uniforms.map.value` pożycza tło menu) i gwiazdy — węzły za adapterem uniformów.
  Maska słońca: JEDEN import z `sunShadowMask.js` (TSL, zadanie 03) — `sunVisibility()` na ciałach przy ringu
  (`uSunShadowRecv = 1`; planety tła w perspektywie jej nie czytają), `sunShaftBackdrop()` na mgławicy i gwiazdach.
- Gwiazdy (`StarSystem`): WebGPU rysuje punkty zawsze po 1 px, więc to `Mesh` z `InstancedBufferGeometry` (kwadrat ×
  26 000, dane gwiazd w JEDNYM przeplecionym buforze instancji — limit 8 buforów wierzchołków) i kwadrat punktu z GL
  (bok gl_PointSize obcięty do ≥ 1 px, gl_PointCoord z rogów, t w dół). Nie wracaj do `THREE.Points` z rozmiarem.
  Skok (zadanie 22): smugi PŁASKIE wzdłuż kursu i front wyjścia od dziobu z `WARP_STARS` (`src/3d/warp/stars.js`, pisze
  tylko sterownik warpa — nie prędkość lotu); dawne rozciąganie i „bicz” przy wyjściu usunięte. Bez warpa gałąź punktu
  jak przed zadaniem 22.
- Poświata limbu: blend ONE/ONE przez `CustomBlending` — `NodeMaterial` z `premultipliedAlpha = true` mnożyłby kolor
  przez alfę w shaderze (ShaderMaterial z tą flagą zmieniał tylko blend).
- A/B planet, księżyców i stacji w prawdziwej grze (harness nie ma kadru z Ziemią przy ringu):
  `node scripts/webgpu/planety-gra.mjs [--root <worktree tagu webgl-baseline>]`, porównanie `porownaj.mjs`.

### Ring „Halo” (Ziemia, Mars, Jowisz)
- `HaloRingGame` (`src/3d/haloRing/haloRingGame.js`): BG warstwa 1, górna ściana i suwnice K-7 w FG (warstwa 2). `haloRings.update(frameDt, cam, …)` co klatkę PRZED `Core3D.render`, z kamerą TEJ klatki (`cam` ze wstrząsem) — ring liczy pozycje względem kamery (RTE), inna kamera przesunie go względem statków. Jakość = `OPTIONS.planetQuality` („Ultra” = dalszy LOD, `HALO_LOD_ULTRA`).
- Ring jest PRZESZKODĄ w płaszczyźnie gry: płyta podłogi z terenem, przelot tylko 4 tranzytami (`stepShipRingCollisions`, `haloRings.pointInSlab` dla pocisków). Nowe ruchy statków przy Ziemi/Marsie/Jowiszu (spawny, teleporty, autopiloty) muszą tę płytę omijać.
- Stacja Ziemi, Marsa i Jowisza = stacja-port w hali K-7 (`ringPort`, `isCollidable: false`, `terminalRange`) — wyglądem stacji jest ring: nie rysuj dla niej brył ani ikon stacji.
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
  `uniform().onObjectUpdate`, macierze grup ruchomych (suwnice, złączki) oraz emisja grup, lampy, paleta, emisja i
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
  `textureLoad`. Demo `halo_ring_demo`: post = `BloomGry` z × `BLOOM_ZGODNOSC_WEBGL` jak gra (wcześniej bloom dema był
  3 × słabszy niż w bazie — jasne kadry nie dawały się porównać); porównanie samego ringu z bazą z tagu:
  `halo-ring-shots.mjs --czesci terrain,structure,structureTop,clouds,shell,mega,city,k7 --bez-otoczenia`.

### Menu główne i jego tło 3D
- Tło menu przed startem gry = Ziemia z ringiem w kamerze kinowej: `MenuBackdrop3D` (`src/3d/menuBackdrop3D.js`). Ring to ring GRY wypożyczony przez `haloRings.showcaseRing('earth')` (mapy pieką się już w menu) i oddany `releaseShowcase` w `stopMenuBackdrop()` tuż przed pierwszą klatką gry (`startGame`). Nie twórz drugiego ringu dla menu.
- Render: `Core3D.renderBackdrop(camera)` — ta sama scena i post (bloom, ACES), tylko warstwa `MENU_BACKDROP_LAYER` (9; na czas menu ring ma na niej wszystkie siatki). Ziemia i niebo tła są dziećmi grupy ringu i liczą światło w układzie ringu (`uCamLocal`, `uSunDir`, `haloRingBlock` z `haloRingTSL.js`); tekstury Ziemi pożyczone od planety gry (`window.EARTH`), mgławica od `NebulaSystem`. Materiały w TSL (`src/3d/menuBackdrop3D.tsl.js`, zadanie 11, 1:1 z dawnym GLSL — Ziemia z poświatą bit w bit z bazą WebGL); mgławica próbkowana z poziomu 0 (pułapka 28).
- Start tła jest w tle, pod kurtyną (`.mm-curtain`): `Core3D.ready` → ring (`showcaseRing`: pieczenie map, odczyt CPU, bryły rozgrzane przed podpięciem — hak `prewarm`) i równolegle Ziemia, poświata i niebo w `Core3D.warmup.now(…, { camera: kamera kinowa, layer: MENU_BACKDROP_LAYER })` → pętla renderu dopiero z gotowym ringiem (`await ring.ready`) i rozgrzanym tłem: pierwsza klatka menu niczego nie kompiluje. Pipeline'y pieczenia map kompiluje sam `HaloWorldMaps.init()` na PRAWDZIWYCH celach bake'u (klucz pipeline'u zależy od formatu celu); dawna scena rozgrzewki `createHaloBakeWarmup` usunięta (11) — pilnuje `tests/menuBackdrop.test.mjs`.
- **Rozgrzewka pipeline'ów (zadanie 11, `src/3d/rozgrzewka.js`, `Core3D.warmup`):** w WebGPU klucz pipeline'u to graf materiału + układ atrybutów + cel (format, próbki, głębia) + światła passa + typ kamery + stan (mieszanie, głębia, strona), więc rozgrzewa się PRAWDZIWE obiekty w PRAWDZIWYM celu. Moduł dopisuje się JEDNĄ linią (przy imporcie też — wpisy czekają na urządzenie, a funkcja `objects` woła się dopiero w chwili rozgrzewki):
  `Core3D.warmup.add({ name: 'moje efekty', objects: () => MojaPula.warmupMeshes(), phase: 'loading' });`
  Każda siatka poddrzewa to osobne zadanie: `compileAsync(siatka, kamera passa jej warstwy, Core3D.scene)` z celem `composerTarget` (warstwa DIST — `distortionTarget`), widoczna i bez cullingu tylko na czas wywołania. Opcje: `layer` (liczba albo `'all'` — obiekty jeszcze poza passem), `camera` (własna), `visible: false` (tylko to, co już widać — przegląd sceny), `variant: { apply(siatka) → przywróć }` (drugi stan materiału, np. przezroczystość), `target` / QuadMesh (pass pełnoekranowy — własna kamera, bez świateł sceny), `split: false` + `override` (cała scena z materiałem zastępczym — pre-pass halo), `alive: () => bool` (właściciel zwolnił obiekty), `phase: 'loading'` (pula, którą `objects()` tworzy — dopiero na ekranie ładowania, jak przy pierwszym użyciu w grze). Pilne `now(obiekty, opcje)` → Promise (tło menu, bryły ringu przed podpięciem) idą przed `add`. Praca w tle: `requestIdleCallback`, po jednej siatce (budowa NodeBuilder jest synchroniczna, ~1–95 ms), pipeline'y w tle GPU; `Core3D.warmup.flush()` w `startGame` (po `waitForPlanetsReady`) dokańcza kolejkę i czeka na pipeline'y (limit 4 s). Wpisy dziś: passy Core3D (w menu: tło, planety, poświaty, ring-planety, pre-pass halo, quady halo i maski słońca; na ekranie ładowania wszystkie passy z tym, co jest w scenie), dysze SIDE (`engineExhaustBatch.js`), światła pozycyjne (`shipLights3D.js`), bryły ringów (hak `prewarm`). Pomiar: `Core3D.warmup.stats`, przestoje klatek — harness (`wyniki.json`: `przestoje` scen, `sesje`), start w prawdziwym czasie — `scripts/webgpu/start-gry.mjs [--root <worktree tagu>]`; oba liczą pipeline'y utworzone SYNCHRONICZNIE (`pipeline.sync`, `syncLista` = „materiał @ obiekt” — to, czego nikt nie rozgrzał; przestój przychodzi zwykle klatkę później, przy zapisie do kolejki). „Przed” tym samym harnessem: `zrzuty.mjs --root <eksport main>`. `Core3D.prewarmPass` zostaje dla modułów, które przełączają widoczność wokół wywołania (projekcja synchroniczna, cały pass naraz).
- Style menu: `assets/css/main-menu.css` (osobny plik, wczytywany po `main.css`). JS menu szuka widoków po id i przycisków po klasie `menu-btn-styled` (pad/klawiatura); stare reguły tych klas neutralizuje `all: unset` w zasięgu `#main-menu`.

### Stacje i obiekty 3D
- `updateStations3D(stations)` — synchronizacja stacji 2D -> 3D.
- Zniszczenie stacji: `destroyStation3D` → `Destruction3D.shatter` (odłamki paneli + wygaszenie bryły), progi HP →
  `Destruction3D.detachChunk` (fragment leci, pęka na kawałki z maską cięcia, potem odłamki). Materiały rozpadu w TSL
  (`src/vfx/shatterMaterial.js`); nowa bryła stacji ma przejść przez `Destruction3D.prebake` (wypiek + rozgrzewka — bez niej
  pierwszy rozpad buduje materiały w swojej klatce). Szablon GLB nietknięty: wygaszenie i kawałki pracują na klonach.
- `updateWorld3D(dt, t)` — aktualizacja obiektów świata 3D.

### Statek gracza
- Obiekt `ship`: pozycja, kąt, prędkość, masa, shield/hull.
- Sterowanie i fizyka gracza: `shipEntity.js`.
- Kadłub, kolizje i destrukcja: `ship.beamHull` (`hullBodies.js`, silnik belek) — jak u NPC i wraków.

### Kadłuby na belkach (`hullBodies.js`, `docs/PORT-silnik-belek.md`)
- Encja z kadłubem ma `beamHull`, nie `hexGrid`. Budowa: `HullBodies.createHull(entity, obraz, { visualImage })` z tego samego obrazu, który dostawał `initHexBody`; zwolnienie: `HullBodies.release`.
- Układ silnika = układ renderu Core3D: `X = x`, `Y = −y`, `θ = −(angle + spriteRotation)`. Kotwica encji: statek = środek sprite'a, wrak = środek masy (`anchorMode: 'com'`, `hull.pivot`).
- Gra całkuje ruch encji; `HullBodies.step` w `physicsStep` synchronizuje ciało w obie strony. Nie pisz pozycji węzłów ani `body.pos` z gry — ruszaj encję.
- Trafienia i zapytania tylko przez `HullBodies` (`sweep`, `impact` = krater z budżetem HP, `probe`, `cutSegment`); styk dla AI: `HullBodies.hasContact`; sufit HP: `HullBodies.structuralState`.
- Nowy wrak z kadłuba (śmierć, rozpad, wybuch reaktora) idzie przez `convertToWreck` / `shatter` / hak `onWreck` — nie składaj go ręcznie.
- Siatka 15 px jak w demie (`HULL_BODY_CONFIG.cellPx`); jednostką strojenia zostaje dawny heks (`HEX_PITCH_PX` = 7,5): węzeł = `hull.hexPerNode` heksów (HP ×4, łup, tempo cięcia, promień krateru). Nową wartość „na komórkę” przeliczaj przez `hexPerNode`. Nie zagęszczaj siatki bez pomiaru ciągłego styku — przy 7,5 px pchany okręt budził się cały i nie zasypiał (krok 2,7 ms zamiast 0,13).
- Dwie masy: ciało w silniku ma masę ZDERZEŃ z powierzchni kadłuba (`HULL_BODY_CONFIG.massPerArea`, jedna gęstość jak demo — Atlas ≈ 800 tys.), `entity.mass` to masa GRY (ciąg ∝ masa, separacja AI, holowanie, asteroidy). Nie przepisuj jednej w drugą: `syncOut` skaluje masę gry i `inertia` w stosunku ubytku masy ciała, wrak dostaje masę w skali gry rodzica.
- Materiał kadłuba (port WebGPU, zadanie 04): graf TSL RAZ na wariant (`src/3d/hexShips3D.tsl.js`: skóra belek, siatka heksów, płyta pancerza, szczątki GPU), każdy kadłub dostaje lekki `HullNodeMaterial` z tymi samymi węzłami — nie buduj grafu na encję (NodeBuilder ~12 ms CPU na kadłub, spawn 30 NPC: 389 ms zamiast 14). Wartości per encja w `material.uniforms` (obiekty `{ value }`), wspólne (czas, strojenie światła, żar) w `HULL_SHARED` (raz na klatkę), lampy statku i strefy dysz w buforze storage `HullLightStore` (slot na kadłub, zapis tylko przy zmianie podpisu). Nowe dane per kadłub: holder w `createHullUniforms` + `perObject()` w grafie, nie pole-liczba materiału (klucz three bierze liczby jako 0/1). Maska słońca kadłubów, odłamków i smug: JEDNO miejsce importu (`sunVisibility`/`sunFill`/`sunShadeUnlit` w `hexShips3D.tsl.js`). Haki: mapa ran i światła efektów (zadanie 18: `hullDamageSurface`, `hullDamageHeat`, `hullEffectLights`), ośrodek wolumetryczny (zadanie 21: `hullVolume`, `kolor·a + rgb`).

### Mostki (zniszczenie mostka = kill)
- **Stan 2026-09-25: mostki i rdzenie wymagają `hexGrid`, więc na kadłubach belkowych są nieaktywne do ich portu (etapy 4–5 w `docs/PORT-silnik-belek.md`).** Opis niżej dotyczy docelowego zachowania.
- `src/game/shipBridge.js` (strefy heksów, integralność, oś czasu), `src/game/shipBridgeRuntime.js` (klej gry), `src/3d/bridgeFx3D.js` (okna, wyrzut atmosfery). Opis: `docs/PORT-mostki.md`.
- Utrata dowodzenia robi z NPC hulka (`isBridgeHulk`): `npcStep` pomija AI i model lotu, `applyDamageToNPC` i sufit heksów go nie ruszają, po `BRIDGE_KILL_TIMELINE.sequenceEnd` `finishBridgeKill` robi wrak BEZ losowego wybuchu reaktora. Nowe ścieżki śmierci / AI / celowania muszą to respektować.
- AI celowo nie celuje w mostki (za szybko zabijałoby gracza) — tylko przyszli „bossowie”.
- Model 3D mostka: `src/3d/bridge3D.js` (+ `bridge3DShapes.js`, graf TSL w `bridge3D.tsl.js`), `docs/PORT-mostki.md` §8. Wyrwy tylko z heksów 2D (bufor obrażeń), nic nie zmienia gameplayu. Cień na kadłubie to prostokąt POD kadłubem z `depthFunc GREATER` — działa, bo kadłuby (renderOrder 10) piszą głębię w passie ortho na z ≈ 0; zmieniając głębię/z kadłubów, sprawdź cień mostka. `bridgeState.model3D` wyłącza szczeliny okien w `bridgeFx3D` (wyrzut atmosfery zostaje). Model przechodzi na wrak sam, po przynależności heksów — nie dokładaj haków w `finishBridgeKill`.
- Mostek na WebGPU (zadanie 15, `docs/PORT-mostki.md` §8.14): JEDEN graf i materiał bryły na wszystkie rodzaje — Mesh + `InstancedBufferGeometry` na rodzaj (nie `InstancedMesh`: jego uuid wchodzi do klucza programu), dane instancji w jednym przeplecionym buforze, stałe rodzaju (obrys, paleta, skala detalu) w tablicy `uniformArray` czytanej indeksem rodzaju z instancji. Obrażenia = bufor storage u32 (bajty RGBA8 w słowie, 768 × 512 komórek; `Bridge3D.damage.data` to widok bajtów), wysyłane tylko zakresami zmienionych bloków (`_markRange`) — tekstury backend WebGPU wysyła w całości (1,5 MB na każdą zmianę). Maska słońca z `sunShadowMask.js` (`sunVisibility` / `sunFill`) w jednym miejscu grafu; okna, lampy, szczeliny `bridgeFx3D` i światła pozycyjne `shipLights3D` maski nie czytają. Rdzenie z dem (`reactor3D.js`, `coreFx3D.js`, grafy w `*.tsl.js`) — w TSL, dalej niewpięte w grę.
- **Nowy kadłub (nowy albo podmieniony sprite okrętu) = od razu mostek**: strefa w `BRIDGE_LAYOUT_PROPOSALS`, model w `bridge3DShapes.js`, paleta w `bridge3D.js` — checklista `docs/BRIEF-mostek-nowego-kadluba.md`. Mostki ma cała flota bojowa (Terra Nova, piraci, Atlas) i lokomotywa megafrachtowca; frachtowce cywilne i myśliwce nie.

### Silniki: MAIN, WARP, SIDE
- `src/3d/engineVfxSystem.js` rozdziela dysze: MAIN → `mainExhaust3D.js` (struga + iskry z `Fx3D.spark`, jedna pula na flotę), WARP → `warpPlume3D.js` (plazma z tych samych dysz MAIN na czas ładowania/skoku, pula z limitem `WARP_PLUME_CAP`, nadmiar dostaje strugę MAIN z dopalaczem), SIDE → stary `engineExhaustBatch.js`.
- Wszystkie trzy w TSL (zadanie 13, obraz 1:1 z WebGL — `scripts/webgpu/silniki.mjs`). Plazma WARP: JEDEN graf na rodzaj (plume w wariancie jakości — kroki marszu i oktawy to stałe grafu, poświata, cząstki), instancja puli ma własne materiały na tych węzłach, a jej wartości w `material.uniforms.X.value` czyta `uniform().onObjectUpdate` — nowa instancja nie buduje shadera (nie wracaj do `new ShaderMaterial` / nowych węzłów na instancję). Cząstki = kwady na instancjach (WebGPU rysuje punkty 1 px). SIDE: dane instancji w jednym buforze z przeplotem (limit 8 buforów wierzchołków). Mieszanie efektów „premultiplied” (alfa = max(rgb)) przez `blendAddytywnePremul` (`src/3d/tsl/mieszanie.js`).
- Rozmiar i palety MAIN/WARP są PER STATEK: blok `engineFx` w danych edytora (`hpEditor.v1` → `ships[id]`), domyślne dopasowane do sprite'ów w `src/data/engineFx.js` (`ENGINE_FX_DEFAULTS`). Dysza w pikselach PNG, w grze × hpScale × spriteScale (jak markery). Gra czyta `visual.engineFx` (runtime NPC, układ gracza); nowy kadłub z dyszami MAIN potrzebuje wpisu w `ENGINE_FX_DEFAULTS` (pilnuje test).
- Tryb skoku encji: gracz z `GameState.warp`, NPC `state === 'warping_in'` / `phase === 'warping'`, podgląd edytora `__warpPreview`, przyloty i odloty tunelem „Nurtu” — `entity.__warpNurtMode` (`'charging'` / `'active'`, pisze `WarpNurt`). Dopalacz MAIN: `GameState.boost`.
- Jasność dysz SIDE: `ENGINE_HDR` w `engineExhaustBatch.js` (0,6). W bloomie ma świecić tylko dysza, która odpala (mnożnik 1 + 1,5 · ciąg); biały „pilot” w spoczynku (= `ENGINE_HDR`) i sam lot (`moveGlow`) zostają pod progiem 0,9 — przy 2,4 każda z 8 dysz Atlasa świeciła jak lampa, a manewr zalewał burtę białą plamą (pilnuje `tests/renderBugfixGuards.test.mjs`). MAIN zostaje 1:1 z dema (świadomie). Audyt: `docs/AUDYT-bloom-kolizje-2026-09-26.md`.
- Gorące powietrze dysz = port maski z dema plazmy w „uber” postu (`src/3d/tsl/postGry.js`, `Core3D`): źródło z kierunkiem (`pushHeatHazeWorld(..., dirX, dirY)`) to DYSZA — `radiusWorld` = promień wylotu, siła = rampa mocy; stożek 7R zaczyna się ~1R za wylotem (dysze siedzą na krawędzi kadłuba), przesunięcie ~0,12 promienia dyszy na ekranie. Źródła bez kierunku (wybuchy, rakiety, tarcze) liczą się po staremu.
- Shadery efektów w passie ortho: bez `pow()` z możliwie ujemną podstawą i z clampem varyingów — MSAA ekstrapoluje je poza trójkąt, a NaN w buforze HalfFloat bloom rozlewa na cały ekran.

### Wraki: gorące, śpiące, zimne
- Wraki kadłubów na belkach (`beamHull`) jeszcze NIE zamarzają (`isFreezeCandidate` wymaga `hexGrid`) — port zimnych wraków to etap 3 w `docs/PORT-silnik-belek.md`. Usuwanie wraku: `recycleWreckEntity` (belki → `HullBodies.recycleWreck`).
- `wrecks` = gorące i śpiące (`_wreckSleeping`); `coldWrecks` = zimne (`src/game/coldWrecks.js`, brief `docs/BRIEF-zimne-wraki.md`). Zimny wrak nie ma `hexGrid` (stan siatki w `_coldSnapshot`), nie jest w `wrecks`, siatce pocisków, listach destruktora ani `renderEntities` — rysuje go tylko batch smug. Łup i ładunek zostają na obiekcie.
- Budzenie WYŁĄCZNIE jawne: `thawWreck(w, reason, onReady)` (holowanie, cięcie, rozkaz), max 1 na klatkę. Nowa ścieżka usuwająca wraki obsługuje też `coldWrecks` (`coldWreckSystem.forget`), a nowe odwołanie do wraku (cel, lina, rozkaz) trzeba stemplować w `markColdWreckReferences` — inaczej wrak zamarznie pod ręką.

### Pociski, kolizje, efekty
- Tablice `bullets`, `particles`.
- `bulletsAndCollisionsStep(dt)` — ruch, trafienia, eksplozje, applyImpact.
- Efekty zderzeń kadłubów idą przez `CollisionFX` (`grind` co krok styku, `impact` raz na zetknięcie). `bounceForce` w zdarzeniu to IMPULS (masa × v; na belkach 10⁵–10⁶) — nie skaluj nim efektów. Iskry tarcia (`src/vfx/collisionSparks.js`): budżet = TEMPO z prędkości styku (`COLLISION_SPARKS_TUNE`) w czasie symulacji pary, plus jednorazowy snop na `impact`; jasność iskry przez `gain` w `SparkSystem3D.emit` (atrybut `iGain`, tarcie < 1, trafienia 1). Dawny budżet „na wywołanie z impulsu” sypał 6–10 tys. iskier/s przy zwykłym taranie.
- Iskry (`SparkSystem3D`, API bez zmian) od zadania 19 na puli z dema rakiet (`src/3d/rockets/sparks.js`) w scenie Core3D (krok efektów „iskry”, zegar efektów — biegnie też w pauzie): barwa PER ISKRA — `emit(..., gain, [r, g, b])` albo barwa domyślna (`setColor`), `burst(..., kolor)` barwi tylko swoją serię (dawniej przemalowywał wszystkie żywe); losowość z fxRandom; pętle klatki piszą przez `stage()` + `pushStaged()`.
- Żar skóry kadłubów belkowych: szczyt `HULL_BODY_CONFIG.heatGlowPeak` (nie `DESTRUCTOR_CONFIG.heatGlowPeak`, ten zostaje heksom — asteroidy).

### Efekty broni (WeaponFx, `src/3d/weapons/` — port WebGPU, zadanie 17)
- Wszystkie 27 broni (działa Capital/L/M/S, wiązki, CIWS, laser PD, flak) mają efekty z dema `bronie-webgpu`; dawne `weapon3DSystem.js` (dziś tylko łącznik wstrząsu dla `supernovaMissileBlow.js` do zadania 19), `slugTrail3D.js`, `muzzleFx3D.js`, `railgunFx3D.js`, fabryki trafień overlaya i `FlakBurstVFX` są usunięte. Efekt to tylko obraz: strzał, lot, trafienie i obrażenia liczy gra.
- Moduły: `weaponFxTable.js` (`WEAPON_FX`: broń → rodzina receptury, `SIZE_POWER`, `projectileFamilyFor` dla pocisków spoza tabeli), `recipes.js` (receptury rodzin: `preFire`, `muzzle`, `projectile(size)`, `fly`, `impact`, `charge`, `kerf`, `exit`, `stuck`, `burst`, `beam`), `gpuFx.js` (pule ADD / SPARK / SMOKE / DEBRIS / DIST / ARC — paczki rozwijane w kernelu, nośnik w paczce, początek przy kamerze), `projectiles.js` (8 stylów, jeden draw call), `trails.js` (smugi), `beams.js` (wiązka ciągła, impuls, laser PD), `weaponFx.js` (fasada `WeaponFx`).
- Zdarzenia: strzał = `WeaponShotBus.emit` z `fireWeaponCore` (kierunek lufy `dirX/dirY`; wiązka: `_beamEventScratch` z `kind` continuous / pulse / pd, trafiona encja i normalna powierzchni sprzed krateru); lot = `WeaponFx.sync(bullets)` raz na klatkę renderu (`updateHexShips3D`, po `Turret2D.sync`); trafienie = `spawnBulletImpactEffect(b, x, y, scale, hit)` (dane z `writeImpactHit` — normalna, encja, prędkość względna) za bramkami kadru / rozmiaru i cooldownu komórki; PD gracza (`ciwsStep`, poza szyną) → `WeaponFx.pdShot` / `pdLaser`, pęknięcie flaku → `flakBurst`, Hexlance (`superweapon.js`) → `hexlanceCharge / Fire / Begin / Step / End / Impact / Kerf / Exit`, warsztat rdzeni (`coreFx3D.js`) → `muzzleAt`, `hexlanceImpact / Kerf` z mocą klasy, śmierć NPC (`CanvasVFX.spawnExplosionPlasma`) → `droneBlast`. Kanwa nie rysuje wiązek ani błysków broni.
- **Nowa broń:** dane w `MASTER_WEAPONS` (`src/data/weapons.js`) + wpis w `WEAPON_FX` (istniejąca rodzina albo nowa receptura) + klucz wieżyczki (`normalizeWeaponFxKey`, `FX_PROFILE` w `turret2D.js`). Testy `weaponFxTable` / `weaponRecipes` / `beamRenderPath` pilnują, że każda broń ma recepturę (wiązka — `beam`).
- **Nowa receptura:** paczki przez budowniczego puli `E(pool, rodzaj, n, P, D).speed(a, b)…emit()` (metody budowniczego zostają krótkie — V8 wkleja je, łańcuch nie alokuje), losowanie tylko `fxRandom` (nigdy `Math.random` — sekwencja rozgrywki; stare wizualia — `mainExhaust3D`, `rand` / `coneDir` banku `Fx3D`, `shieldImpactFx`, overlay — jeszcze losują z `Math.random` gry i przez to przebieg bitwy zależy od nich, PLAN §3), zdarzenia opóźnione `ctx.after(opóźnienie, AFTER.RODZAJ, liczby…, encja)` bez domknięć, światła przez `ctx.lights.flash / point` (siatka świateł), wstrząs `ctx.shake` (wylot — `camera.addShake` porównany z resztą; trafienie — tylko gdy gracz strzelał albo oberwał). Barwy w pasmach HDR (rdzenie i błyski > 0,9, ciała 0,3–1,3, smugi: ciało ≤ 1,4); w gorących pętlach `Math.sqrt`, nie `Math.hypot` (alokuje), liczby double do niewklejonych wywołań przez `Float64Array`.
- Budżety: pełnych wylotów i trafień po 48 na klatkę (ponad — tani błysk), LOD wylotu po rozmiarze wieżyczki na ekranie, impulsy w pierścieniu `PULSE_CAP` (1024), stany pocisków 4096, zdarzenia opóźnione 512. Dym i odłamki czytają maskę słońca (`sunVisibility`), emisja nie.
- Mechanika z dema (przebicia, rykoszety, ładowanie Mjolnira / Valkyrie, mapa ran na kadłubie) — zadanie 18: haki `ctx.stamp` (mapa ran, 18-C), `ctx.ricochet`, `WeaponFx.charge` i receptury `kerf / exit / stuck` czekają na logikę gry.

### Nośnik prędkości: pociski i efekty lecą z tym, z czego wyszły
- Pocisk dziedziczy 100% prędkości lufy (ruch + obrót kadłuba, `writePointVelocity`, `src/game/carrierVelocity.js`) i niesie znaczniki: `ivx/ivy` (odziedziczona część), `clock` (gracz/P2 — `CLOCK_RENDER`, reszta `CLOCK_SIM`), `bornSim` (czas pozy lufy). Nowe źródło pocisków robi to samo — bez znaczników smuga, zasięg i kierunek trafienia liczą się w świecie.
- Efekt rodzi się z nośnikiem: `ActiveCarrier.set(writeCarrier(encja, x, y, zRekorduRenderu, scratch))` → spawn → `ActiveCarrier.clear()`, bez wołania w środku innych emiterów. Czytają go Fx3D, CanvasVFX, SparkSystem3D, overlay (efekty z `followCarrier`) i pule broni `WeaponFx` (paczka niesie nośnik — `writeCarrierPacket`, rysunek `fxCarrierOffset`). Wylot = kadłub strzelca, trafienie = trafiony kadłub, pęknięcie i odłamki pocisku = jego `ivx/ivy`. Dysze MAIN celowo bez nośnika (smuga ma zostawać za statkiem).
- Rysowanie: `pos + v · (T − t0)` z `SimClock` (`src/game/simClock.js`): `sim` rośnie w `physicsStep` zaraz po całkowaniu pozycji gracza, `render` = czas interpolowanej pozy gracza (`beginRender` przed `render`). Nie przesuwaj niesionych efektów zegarem klatki — rozjadą się z kadłubem w pauzie i przy interpolacji. Czas pozy: z rekordów Turret2D `fromRender = true`, z pozy fizycznej `false`.
- Wyprzedzenie liczy ruch celu WZGLĘDEM strzelca (`getLeadAim(..., shooterVel)`, `leadTarget`), smuga pocisku = ruch względem strzelca, kierunek wgniecenia = prędkość pocisku względem celu, zasięg Hexlance'a i rakiet = droga własna.
- Rakiety 3D: `rocketSystem3D.fire(..., launchVx, launchVy)` — układ rakiety to pęd wyrzutni (stały, bez dopasowania do celu), lot kinematyczny w nim; przy wyrzutni w spoczynku zachowanie jak dawniej. Canvasowe rakiety i torpedy naprowadzają ruch własny w układzie `ivx/ivy`.
- Efekty rakiet (zadanie 19) niosą nośnik jawnie: smuga, wyrzut, zapłon i wybuch w próżni — układ rakiety (`r.frameVel`); wybuch na kadłubie i receptura tarczy — trafiony kadłub (`vx / vy`), iskry trafienia w gracza w `CLOCK_RENDER`, w NPC w `CLOCK_SIM`; pozostałość Supernowej stoi w świecie (jak w demie).

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
   - Modyfikacje renderera, passów scen (runner `_runScenePass`: tło → planety → halo → ring-planety → ortho → tarcze → FG, wszystko do `composerTarget` HalfFloat MSAA 4, czyszczona tylko głębia) i postu (`RenderPipeline`) rób wyłącznie tutaj.
   - Parametry bloomu (strength/radius/threshold, także dla overlay3D) żyją w `src/3d/bloomConfig.js` — jedyne źródło prawdy; tuner (panel Bloom) nadpisuje je trwale tylko z `?dev` w URL.
   - Bloom przepuszcza przez próg CAŁY teksel (nie nadmiar) i dokłada ~9 × strength jego energii (radius tylko przesuwa wagę między mipami; rozmycia gubią ~3%): Core3D 0,85 → ~7,5×, overlay3D 1,6 przy progu 0,15 → ~14× prawie wszystkiego. Jasność nowego emitera dobieraj z tym w głowie. Core3D od zadania 02: `BloomGry` (BloomNode + ×3 `BLOOM_ZGODNOSC_WEBGL`, `src/3d/tsl/postGry.js`) — obraz 1:1 z dawnym `UnrealBloomPass` (strażnik różnic three: `tests/webgpuPost.test.mjs`); overlay3D do zadania 20 na starym passie.
   - Pipeline jest HDR-first: emitery (pociski, beamy, dysze) mnożą kolory >1.0, próg bloomu ~0.9 odcina zwykłe powierzchnie. Nowe efekty, które mają świecić, muszą wypychać luminancję >1.
   - Nie duplikuj postprocessingu w innych modułach. Nowe efekty GPU: compute przez `Core3D.addFxStep` (raz na klatkę, przed passami), światła przez siatkę (`Core3D.fx.lights` / `ctx.grid`), refrakcja przez `Core3D.fxDistortion()` albo warstwę DIST (`FX_DISTORT_LAYER`) — nie własne `renderer.compute` w pętli gry, własne cele ani passy (`docs/webgpu/FX-INFRA.md` §10).
   - Passy planet (warstwa 3), halo (5), ring-planet (6) i tarcz (7) są pomijane, gdy nikt nie zgłosi na nich widocznej zawartości (`Core3D.layerActivity`). Dodając obiekt na te warstwy, zgłaszaj go co klatkę (`Core3D.markPlanetLayersActive` / `Core3D.setShieldLayerActive`) — inaczej zniknie.
   - Mapa cienia słońca: w WebGPU odświeżanie jest per światło (`renderer.shadowMap` ma tylko `enabled` / `type`). Słońce gry zgłasza się `Core3D.setSunShadowLight(light)`, a `render()` raz na klatkę, na starcie, ustawia `light.shadow.autoUpdate = false; needsUpdate = true` — ShadowNode i tak aktualizuje najwyżej raz na klatkę rAF (kamera cienia z `layers.enableAll()` widzi rzucających na wszystkich warstwach). Nowe światło z cieniem zgłaszaj tak samo.
   - Warp „Nurt” (zadanie 22, `src/3d/warp/`, sterownik `WarpNurt` w `warpNurt.js`): OŚRODEK = 1 mln drobin (`medium.js`, compute przez `Core3D.addFxStep`, krok stały 1/240 s z dosuwaniem w renderze) w passie `warp` (warstwa 8, `WARP_MEDIUM_RENDER_LAYER`, zaraz po ring-planetach, kamera perspektywy, siatka w kamerze gry, dane względem niej). Pass rysuje się tylko po `Core3D.setWarpLayerActive(true)` — sterownik zgłasza go, gdy w zasięgu pudła ośrodka wokół kamery są przegródki (bańka gracza, nić zwiastuna, punkt zbierania, pchnięcie) albo szczeliny; 4 s po ostatniej zasypia: poza warpem ani kroku compute, ani draw calla (daleki przylot też go nie budzi — `cullWarpFrameToView`). BAŃKI zgłaszają: skok gracza (`player.js` na automacie `GameState.warp`, bez zmian rozgrywki), przyloty i odloty NPC (`arrivals.js`; warp-in piratów wykrywany z `npc.state === 'warping_in'`, wezwania przez `WarpNurt.arriveAll`, plan z wyprzedzeniem `planArrival` / `planFleetArrival`, odlot `depart`) — do 16 naraz. W skoku ośrodek płynie z prędkością WIDOCZNĄ (bieg I 16 tys., II 21 tys. j/s), nie prawdziwą. ZGIĘCIE TŁA nie jest osobnym passem: soczewkę bańki i wciąganie w szczeliny liczy materiał mgławicy (`skyBend.js`, blok `WARP_SKY_BEND`; tylko mgławica, jak w demie), gwiazdy — smugi z `WARP_STARS`. Fale = sama refrakcja (`Core3D.fxDistortion().shock`), błyski / szczeliny / smugi sylwetki = duszki w passie ortho (`sprites.js`, kolano bloomu `bloomKnee.js` — demo liczyło bloom bez ×3 gry), odsłanianie, szew i żar brzegu kadłuba = uniformy per obiekt `uWarpA/B/C` w materiale kadłuba (`hullWarp`, `hexShips3D.tsl.js`). Dawne API soczewki (`setWarpLensWorld` … `suppressShadowShafts`) usunięte razem z `warpLens3D` / `warpWorldLens` / `warpFx3D` / `warpLensPass`. Nie próbkuj gotowej klatki 2D i nie wycinaj statku maską — tak powstało kiedyś „jajko” wokół kadłuba. Warstwa 9 to tło menu (`MENU_BACKDROP_LAYER`, rysuje ją tylko `Core3D.renderBackdrop`).
   - Cienie słońca (shadow shafts) to MASKA widoczności, nie filtr obrazu: `Core3D._renderSunShadowMask` liczy ją raz na klatkę (pass TSL — `createShadowShaftsPass`, jeden quad) przed pre-passem halo (`sunShadowTarget`, `src/3d/sunShadowMask.js`; R = cień powierzchni, G = smuga tła z ringami, B = mrok pola). Nowy materiał (TSL) oświetlany słońcem w płaszczyźnie gry importuje z `sunShadowMask.js` funkcje i mnoży przez `sunVisibility()` człon słońca, a otoczenie przez `sunFill(vis)` (w pełnym cieniu `SUN_SHADOW_FILL` = 0,4); światła, żar i glow zostają; bez modelu światła — `sunShadeUnlit(color)`; tło — `sunShaftBackdrop(color)`; wbudowane materiały three — `applySunShadowToBuiltinMaterial` (hak w polach materiału: `setupLightingModel` gasi `direct()` modelu klasy, `outputNode` kładzie smugę — NodeLibrary kopiuje pola na materiał węzłowy). Funkcje czytają maskę po `screenUV` (tylko w węzłach fragmentów) na wspólnych węzłach `sunShadowUniforms` (`.value` jak dawniej; uniformy w grupie renderu). `SUN_SHADOW_GLSL` zostaje TYLKO dla nieprzeniesionych ShaderMaterial (`sunShadowMaskGLSL.js`, na WebGPU i tak zamienniki). Emitery (broń, dysze, błyski, światła pozycyjne, tarcze) i ring „Halo” (własny model słońca) maski NIE czytają. Nie przywracaj quada mnożącego gotowy obraz — gasił broń z warstwy 0 pod progiem bloomu i kładł drugi cień na ring.
   - Cień kadłubów w passie shadow shafts = pole odległości sylwetki (`src/3d/hullShadowSdf.js`: warstwa tablicy tekstur na kształt, pieczenie z budżetem w `updateHexShips3D`, wgranie jednej warstwy przez `Core3D.uploadTextureLayer`). Okluder statku zgłaszaj przez `Core3D.pushShaftHullSdf` z danymi z `packHullShaftOccluder` (to samo przekształcenie co mesh kadłuba). Zmieniając `hullSdfShadow` (TSL), zmień też lustro `traceHullShadowCpu` — na nim stoją testy; maskę w grze porównuje z bazą WebGL `scripts/webgpu/maska-slonca.mjs`.

2. **Moduły 3D (`world3d.js`, `stations3D.js`, `hexShips3D.js`)**
   - Używaj `Core3D.scene` i `Core3D.camera`.
   - Nie twórz lokalnych rendererów ani dodatkowych canvasów WebGL.
   - Świat leży przy 5–10 mln j.: pozycja świata liczona na GPU we float32 drga ~1 px względem kadłubów. Nie wpisuj bezwzględnych pozycji do macierzy instancji ani atrybutów — duży offset w `mesh.position` (three składa `modelViewMatrix` w double), dane względem niego, w shaderze `modelViewMatrix * instanceMatrix`. Wzór: `Bridge3D._setOrigin` (`docs/PORT-mostki.md` §8.12).
   - Początek przy kamerze daje `sceneOriginNearCamera` (`src/3d/sceneOrigin.js`); dane przepisywane co klatkę — początek co klatkę (np. `shipLights3D.js`, `fxParticles3D.js`), bufor pisany raz przy emisji (pierścień) — początek „lepki” z przesunięciem żywych danych dopiero po odjeździe kamery (`sparkSystem3D.js`; pule GPU: `FxPoolOrigin` + kernel przesunięcia w `src/3d/fx/gpuPoolOrigin.js`, np. efekty broni). Pozycje świata w pulach CPU: `Float64Array`. Pomiar przed/po: `dema/precyzja-drzenie.js` (bloom wyłącza `perfToggles.bloom = false` — od zadania 02 post czyta go w każdym renderze).
   - Przezroczysty materiał z `side: DoubleSide` three rysuje DWA razy (tył, potem przód) i przed każdym ustawia `needsUpdate` — każdy draw liczy program od nowa (`getProgram`). Nie dotyczy `ShaderMaterial` (ma `forceSinglePass = true`), dotyczy `MeshBasicMaterial` i innych wbudowanych: efekty addytywne bez zapisu głębi i płaskie siatki dostają `forceSinglePass: true` (pociski, błyski, wiązki, iskry raila).

3. **Destruction + ship integration**
   - Zachowaj spójność osi/rotacji między `shipEntity.js` i `hullBodies.js` (odbicie y, kotwica środka sprite'a).
   - Unikaj alokacji w gorących pętlach (kolizje, spatial queries, contact buffers).
   - Krok fizyki `PHYS_HZ` domyślnie 120 Hz (`?physHz=60` do testów A/B). Nowe stałe „na krok” (mnożniki tłumienia, liczniki w tickach) tylko przez `stepDecay120` / `ticksAt120` z `src/game/stepDecay.js` — inaczej zmiana kroku zmienia zachowanie gry.
   - Silnik belek: magazyny węzłów i belek to SoA (`beamStore3D.js`) — pola dodawaj jawnie po nazwie w konstruktorze (inaczej V8 przechodzi w tryb słownikowy) i w `gatherNodeFields`. Zmiana fizyki = sprawdzenie złotych stanów (hash stanu kanoniczny) i testów `tests/beam*.test.mjs`.
   - (Heksy — dziś tylko asteroidy.) `hexGrid.grid` jest indeksowana komórką POCZĄTKOWĄ heksa, a wgnieciony heks stoi do `_maxHexDrift` px dalej. Szukanie heksów w oknie komórek (sondy trafień, raymarch wiązki) musi doliczyć `getHexProbeDrift(grid)` — inaczej heksy-duchy: pocisk przelatuje przez wgniecenie. Trafienie, które zna heks, podaje go do `applyImpact(..., { shard })` (w `index.html`: `applyHexImpact`), zamiast szukać drugi raz.
   - Solver sprężyn GPU kroczy w czasie gry (`gpuSoftBodyHz` = 60), nie w klatkach renderu; liczniki dispatchera są w krokach 60 Hz.

4. **Wydajność**
   - Bez nowych alokacji per-frame tam, gdzie da się użyć pooli/buforów.
   - Profiluj przez `PerfHUD` (`performance.now()`), szczególnie: physics/draw/3D update.
   - Pętle „każdy kadłub × każde światło/emiter” w `updateHexShips3D` (payload świateł, `buildCombinedShipLightShaderPayload`): dane celu (pozycja, promień) raz na kadłub, w pętli po światłach sama arytmetyka. Liczone per para kosztowały w bitwie ~125 okrętów większość „U hex” (4,5 ms). Własne lampy kadłuba są w cache per encja — obiekty lamp z payloadu tylko do odczytu.

5. **Kolejność rysowania**
   - 3D world pass -> 2D world/HUD.
   - Nie przywracaj starych, równoległych ścieżek `drawPlanets3D`/`drawStations3D`/`drawWorld3D` jako osobnych finalnych passów, jeśli render jest już zunifikowany przez `Core3D`.

---

## Konwencje PR dla agentów

- Nie dodawaj frameworków ani bundlera.
- Trzymaj zmiany małe i izolowane.
- Nie zmieniaj API bez potrzeby i opisu skutków.
- Zachowuj kompatybilność warstwy grywalnej 2D.
- Nie kopiuj do `public/` plików, które `index.html` ładuje z roota (`assets/css/*`, `src/*`): Vite w dev podaje `public/` PRZED rootem, a build bierze root — do 2026-09-26 dev pokazywał sierpniową kopię `main.css`. Pilnuje `tests/devPublicShadow.test.mjs`.


### Lista kontrolna PR
- [ ] Brak nowych rendererów (WebGPU / WebGL) poza `Core3D` (wyjątek przejściowy: overlay efektów do zadania 20).
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