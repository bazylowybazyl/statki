# Infrastruktura efektów GPU — `src/3d/fx/` (zadanie 12)

> 2026-09-27, część 12-A zadania 12: czyste moduły wspólnej infrastruktury nowych efektów (broń 17–18, rakiety 19,
> asteroidy 21). Testy: `tests/fxLightGrid.test.mjs`, `tests/fxInfra.test.mjs` (grafy TSL budowane do WGSL w Node).
> Stan dem, z którego scalono: `dema/asteroidy-webgpu/lights.js` — kopia robocza z `main` 2026-09-27 (niezacommitowana,
> sesja dema trwa; baza w repo: 5e4001d), `dema/bronie-webgpu/*` — 3a0c5b2, `dema/rakiety-webgpu/*` — 174b271.
>
> 2026-09-28, część 12-B: **wpięcie w Core3D** (`src/3d/fx/fxFrame.js` = `Core3D.fx`, §10), zniekształcenia i siatka
> bezpieczeństwa NaN w „uber”, bank `Fx3D` w TSL (§11). Testy: `tests/fxCore3D.test.mjs`, `tests/fx3dTSL.test.mjs`;
> kontrola na GPU: `scripts/webgpu/efekty-kontrola.mjs` (§12).

| Moduł | Co | Główne API |
|---|---|---|
| `lightGrid.js` | jedna siatka świateł gry (z 3 kopii w demach) | `LightGrid`, `GridLighting`, `GridLightsNode`, `enableGridLights`, `addShipLights`, `FIELD_SHIP_LIGHTS`, `CAVE_SHIP_LIGHTS` |
| `fxLights.js` | błyski i światła punktowe efektów → siatka | `FxLights.flash / point / update / commit / setView` |
| `fxRandom.js` | generator warstwy efektów (mulberry32) | `FxRandom`, `fxRandom` (+ `window.fxRandom`) |
| `noise.js` | tekstury szumu pieczone raz | `bake*` (dane), `create*Texture`, `fxNoise` |
| `carrier.js` | nośnik w paczkach cząstek GPU | `writeCarrierPacket`, `fxCarrierOffset`, `fxDragPath`, `fxCarriedPosition`, lustra CPU |
| `gpuPoolOrigin.js` | początek pul GPU przy kamerze, zegary względem epok, kernel przesunięcia | `FxPoolOrigin`, `createShiftKernel`, `applyShiftCpu` |
| `distortion.js` | źródła zniekształceń (fala, implozja, gorące powietrze) w jednym bloku | `DistortionField`, `distortionOffset`, `sampleDistorted`, `distortionOffsetCpu` |

## 1. Siatka świateł (`lightGrid.js`)

### Różnice trzech kopii

| | asteroidy (`lights.js`, kopia robocza) | bronie (`lightGrid.js`) | rakiety (`lights.js`) |
|---|---|---|---|
| Pochodzenie | wersja najnowsza | kopia asteroid z 9859d07 | kopia asteroid z cb02194 |
| Prostokąt reflektora w `build` | wycinek koła (próbki łuku) | pełne koło | wycinek koła |
| Stożek w `loop` | smoothstep² (bez „łopat wiatraka”) | smoothstep | smoothstep |
| Mapy cienia (L3.z → `grid.shadows.visibility`) | tak (atlas `spotShadows.js`) | nie | nie |
| Właściciel (L3.w, `material.lightOwner`) | tak | tak (bez świateł statków) | tak |
| `addShipLights` | profile `FIELD_`/`CAVE_SHIP_LIGHTS` (reflektory 36°, boczne ×2,8, rozpraszanie per światło), atlas cieni per reflektor | brak | stara wersja (30°, boczne 110° ×1,0; `shadowIndex` jako flaga), domknięcie `spot` na wywołanie |
| Statystyki | `itemsUsed`, `dropped`, `cellW/H`, `stats` | tylko `stats` | jak asteroidy |

Rdzeń (tłumienie `(1 − x²)² / (1 + 4x²)`, sumy prefiksowe na CPU, `LIGHT_CAP` 1536, `ITEM_CAP` 2¹⁸, 64 × 40 komórek,
układ 4 × vec4 na światło) jest wszędzie ten sam.

### Wybór

Baza = kopia asteroid (najpełniejsza: wycinek, smoothstep², cienie, właściciel, profile). Dla bronie / rakiet
różnica w obrazie dotyczy tylko reflektorów (efekty broni i rakiet dodają światła dookólne): stożek smoothstep² zamiast
smoothstep i nowe profile statków (decyzje użytkownika z sesji asteroid). Zmiany pod grę:

- **Początek przy kamerze:** `begin(originX, originY)` (układ SCENY: x, −y świata — jak `sceneOriginNearCamera` i
  `FxPoolOrigin`), `add` w układzie lokalnym, `addWorld(x, y, …)` ze świata gry liczy różnicę w double;
  `worldOriginX/Y` dla kodu z dem (`x − ox, −(y − oy)`). Materiały obiektów w pozycji bezwzględnej (kadłuby) dostają
  punkt lokalny z widoku: `localPosition()` = obrót kamery · `positionView` + (kamera − początek) — `camLocal` liczone
  w double na CPU raz na `render()`; dokładne przy 6–10 mln j. (tryb `'world'` = `positionWorld − początek`,
  ~0,5–1 j. szumu float32).
- **Dwa bufory storage zamiast trzech:** komórki i listy w jednym indeksie `uint` (`[start, liczba]` na komórkę, potem
  listy). Oba bufory `toReadOnly()` — w compute też `var<storage, read>`.
- **Uniformy w grupie `render`** (prostokąt, odwrotność komórki, `gain`, `camLocal`) — jeden wspólny bufor, świeży w
  każdym `render()` i `compute()`, a nie kopia w buforze każdego obiektu.
- **Odrzucanie przy `add`:** `setBounds(x0, y0, x1, y1)` (lokalnie, kadr z zapasem) — światło, którego koło nie
  dotyka kadru, nie zajmuje puli; `build()` bez argumentów bierze ten prostokąt.
- **Strażnicy NaN:** oś reflektora normalizowana na CPU (zerowa → dookólne), stożek wewnętrzny zawsze węższy od
  zewnętrznego (`smoothstep(e0, e1)` z e0 ≥ e1 jest w WGSL nieokreślony — NaN w HalfFloat rozlewa bloom), odrzucane
  nieskończone pozycje / zasięgi.
- **Naprawiony błąd kopii dem:** granice komórek w `Int16Array` przepełniały się dla świateł daleko poza kadrem (np.
  −1,2 mln j. lokalnie → zakres komórek 0…5618) — w demie ~10⁵ pustych iteracji na takie światło na klatkę, w
  scalonym indeksie groziło zapisem poza komórkami. Teraz jawny pusty zakres (test „daleko poza kadrem”).
- **Właściciel 0 = brak:** materiał pomija światła właściciela tylko, gdy jego właściciel ≥ 1 (w demach materiał z
  właścicielem 0 gasiłby wszystkie światła efektów, które mają właściciela 0).
- Zmienna pętli nazwana (`gridItem`) — `loop` można zagnieżdżać; `cb` dostaje też `flare` i `owner`.
- `sampleCpu(px, py, pz, skipOwner)` — lustro CPU pętli (testy, zapytania CPU).
- `addShipLights`: bez domknięcia i tablicy `[encja]` na wywołanie, `pos ?? x/y` (NPC całkują x/y), wywołanie
  skrócone `addShipLights(grid, encja, długość, opts)` (początek siatki).

### Kto czyta siatkę (zadanie 12, krok 2)

`GridLighting(grid, { mode, positionMode })` → `renderer.lighting` **PRZED `await renderer.init()`** (12-B: three r183
tworzy w `init()` `RenderLists(this.lighting)` — podmiana po init nic nie zmienia, siatka po cichu nie działa; własna mapa
scena → węzeł, bo bazowy `Lighting` trzyma ją w zmiennej modułu i zostawiłby węzeł poprzedniego systemu):

- `mode: 'optIn'` (**zalecany w grze**) — siatkę czytają tylko materiały z `gridLights === true`
  (`enableGridLights(mat, owner)`); flaga jest zwykłym polem materiału, więc wchodzi do klucza programu. Materiał bez
  flagi ma **WGSL identyczny jak bez `GridLighting`** (test) — planety, tło, stacje, ring i kalibracja bez zmian kodu
  i obrazu. Kadłuby włączą ją w 18, dym rakiet czyta ją w compute (19).
- `mode: 'all'` — jak dema: każdy oświetlany materiał poza `gridLights === false`.
- Właściciel: `enableGridLights(mat, uniform(0).onObjectUpdate(({ object }) => …))` — JEDEN węzeł na wariant materiału
  (wspólny graf = wspólny program, PLAN §3); pole `lightOwner` z dem też działa.

Koszt pętli (12-B, RTX 5080, 1920 × 1080, `efekty-kontrola.mjs` E2 — płaszczyzna `MeshStandardMaterial` na CAŁY kadr
w passie ortho, mediana GPU klatki z 2 serii na przemian): bez flagi 0,286 ms, z flagą i pustą siatką 0,295 ms (**+0,01
ms** — odczyt dwóch buforów i pusta pętla na piksel), z 256 światłami (zasięg 800 j., ~25 świateł na komórkę przy zoomie
0,3) 0,79 ms (**+0,50 ms** na pełny ekran; kadłuby w 18 pokryją ułamek kadru). CPU klatki efektów z 256 światłami
(budowa siatki): 0,25 ms. Materiał z flagą przy pustej siatce = bez flagi co do bitu (kontrola E).

### Klatka

`grid.begin(origin.x, origin.y)` → `setBounds(kadr lokalnie z zapasem)` → `addShipLights(…)` / `fxLights.commit(grid,
t)` / `add…` → `grid.build()` (raz) → render i compute czytają bufory. Mapy cienia (`grid.shadows = atlas`) i materiały
z siatką — przed pierwszą kompilacją.

Koszt CPU `add` + `build` (Node 22, Ryzen 7800X3D, kadr 5200 × 3200 j., 20% reflektorów): 64 światła — 0,06 ms,
256 — 0,17 ms, 1024 — 0,69 ms, 1536 — 1,1 ms przy zasięgach ≤ 800 j. (efekty: 60–1100 j.); przy zasięgach do 3000 j.
1024 światła — 2,7 ms i `ITEM_CAP` nasycony (wpisy ponad limit giną w `stats.dropped`). `fxLights.commit` 512 błysków
+ 512 punktów — 0,09 ms. **Ryzyko (21, 18):** reflektor dalekiego zasięgu statku (`FIELD_SHIP_LIGHTS.spot` do 14 tys. j.)
pokrywa większość kadru — w dużej bitwie w polu asteroid ograniczyć reflektory do najbliższych kamery / w kadrze.

## 2. Światła efektów (`fxLights.js`)

`flash(x, y, r, g, b, moc, zasięg, życie, decay = 2, flicker = 0, z = 60, grow = 0, scatter = 0,6)` — kolejność jak
w demie broni, opcje pozycyjnie (`{ decay, z }` → `, 2, 0, 30`); `point(x, y, r, g, b, moc, zasięg, z = 40)` — jedna
klatka; `update(dt)`; `commit(grid, czasEfektów)` → `grid.addWorld`. Pule typowane (SoA), zero obiektów na
wywołanie i na klatkę (test: przyrost young generation V8 ≈ 0 na 5000 klatek; jedyna alokacja to pakowanie liczby
double w argumencie przez V8 poza modułem). Faza migotania z `fxRandom`.

**Nośnik:** błysk czyta `ActiveCarrier` przy narodzinach i jedzie z nim: `x0 + v · (T_zegar − t0)` z `SimClock` —
błysk lufy Atlasa przy 10 000 j/s nie zostaje 1,4–6 tys. j. za okrętem (w demie rakiet błyski miały własne
`cx, cy`). Kadr: `setView(x0, y0, x1, y1)` (świat) odrzuca błyski i punkty poza ekranem, pula 512 nie zapycha się
bitwą poza kadrem.

## 3. Generator (`fxRandom.js`)

mulberry32 bit w bit jak `Math.random` harnessu (test). `next()`, `range(a, b)`, `int(n)`, `uint32()` (ziarna
kerneli), `chance`, `sign`, `round(n)` (zaokrąglenie losowe emiterów `tempo · dt`), `seed(s)`, `state`. Wspólna
instancja `fxRandom` na `window.fxRandom` — **12-B / 17:** harness ma ją ziarnić razem z `Math.random`
(`H.reseed` → `window.fxRandom?.seed(v)`), żeby sceny z efektami były powtarzalne.

## 4. Szumy (`noise.js`)

Jedno źródło czterech tekstur z dem (dane **bit w bit** jak w demach — test sum FNV): `tile2D` (bronie, szum wartości
RGBA8 256²), `cloud2D` (rakiety, gradientowy RGBA8 256²), `noise3D` i `curl3D` (rakiety, RGBA16F 64³). `bake*` — czyste
funkcje (można w workerze), `create*Texture` — tekstury three, `fxNoise.tile2D()…` — jedna wspólna instancja,
`fxNoise.bakeAll()` do rozgrzewki (~0,25 s CPU łącznie przy zimnym JIT). Szumy dem się różnią (wartości vs gradient),
więc zostają osobno (PLAN §3: duplikaty scalamy tylko przy tym samym obrazie).

## 5. Nośnik w paczkach (`carrier.js`)

`p(T) = p_własne(t) + v_c · (T_zegar − t0)` — opór i turbulencja działają tylko na ruch własny (pule dema tłumiły
całe `v`, dym z pędzącego okrętu zostawał w tyle — PROJEKT-BRONI §0.3). Paczka dostaje vec4 nośnika
`(vx, −vy, t0 − simEpoch, zegar)` (`writeCarrierPacket(tablica, offset, origin.simEpoch)` z `ActiveCarrier`; BSTRIDE
12 → 13 w `gpuFx`), spawn kopiuje go do stanu cząstki. TSL: `fxCarrierOffset(vec4, timeSim, timeRender)` i
`fxDragPath(drag, wiek)` — czyste funkcje z `setLayout` (uniformy parametrami), `fxCarriedPosition(...)`. Lustro CPU
(`carrierPositionCpu`) — test „dym z lufy przy 10 000 j/s zachowuje się względem okrętu jak w spoczynku” i precyzja
float32 < 0,01 j. przy 6 mln j. po 7,5 h gry (z początkiem i epoką).

## 6. Początek pul GPU i zegary (`gpuPoolOrigin.js`)

`FxPoolOrigin` — jeden wspólny dla pul efektów i siatki:

- stan w double: początek `x, y` (scena), epoki `fxEpoch` (zegar efektów) i `simEpoch` (SimClock);
- **lepki:** gdy żadna zarejestrowana pula nie żyje — idzie za kamerą i zegarem za darmo; żywe trzymają go do
  `FX_REBASE_DIST` = 20 tys. j. (demo asteroid) i `FX_EPOCH_SPAN` = 600 s (smugi i iskry gry). Przeskok całkowity
  (zaokrąglenie), więc przesunięcie jest dokładne we float32;
- uniformy (grupa `render`): `timeFx`, `timeSim`, `timeRender` (względem epok), `shift` = (dx, dy, dFx, dSim);
- `register({ shiftNode, isLive(), onRebase(dx, dy, dFx, dSim) })` — `onRebase` przesuwa dane po stronie CPU (np.
  zapakowane, niewysłane paczki), `shiftNode` z `createShiftKernel(origin, { buffer, capacity, stride, pos: [[k,
  'xy']], fxTime: [[k, 'w']], simTime: [[k, 'z']] })` — uogólniony `shift` z dema asteroid (strażnik zakresu
  `instanceIndex`), `dispatch(renderer)` wysyła je raz po przeskoku. **Pula MUSI się zarejestrować** — inaczej początek
  przestawia się co klatkę pod jej danymi.

Kolejność w kroku compute Core3D (12-B):

1. spawn paczek zapakowanych od ostatniej klatki (stara rama),
2. `origin.update(kameraScena.x, kameraScena.y, czasEfektów, SimClock.sim, SimClock.render)` (`sceneOriginNearCamera`),
3. `origin.dispatch(renderer)` — przesunięcie żywych (łącznie ze świeżo zrodzonymi),
4. `grid.begin(origin.x, origin.y)` + światła + `build`,
5. kroki pul (update, światło dymu), render: siatki pul na `mesh.position.set(origin.x, origin.y, 0)`.

## 7. Zniekształcenia (`distortion.js`)

`DistortionField`: `begin()` → `shock(x, y, R, szer., siła px, dysp.)` / `implode(...)` / `heat(x, y, R, siła, dirX,
dirY, wydłużenie, dysp., ziarno)` (świat gry) → `commit(kamX, kamY, zoom, W, H, czas)` rzutuje na widok raz na CPU
(piksele względem środka ekranu — bez dużych liczb na GPU), odrzuca poza kadrem i bierze `DISTORT_CAP` = 32
najsilniejszych. **Jeden bufor uniformów** (tablica vec4: nagłówek 2 + 4 na źródło; limit 12 na etap). Typy z
`rakiety-webgpu/post.js` 1:1 (fala = pochodna gaussa bez obrysu, implozja, gorące powietrze); gorące powietrze bez
kierunku ma wzór dema zakotwiczony w świecie (fazy z pozycji źródła w double — test: przesunięcie kamery go nie
rusza), z kierunkiem — wzór płynie z prądem (~350 j/s), maska wydłużona w dół strumienia. Dyspersja ×0,82 / ×1 /
×1,22.

TSL: `distortionOffset(field.node, uv)` → vec4 (przesunięcie UV, część z dyspersją) — wklejane bez `setLayout`
(czyta tablicę uniformów); `sampleDistorted(tex, uv, off)` — trzy próbki z dyspersją jak `post.js`. Dysze MAIN
(`pushHeatHazeWorld` z kierunkiem), tarcze i fale warpa zostają na swojej ścieżce w „uber” (02). Podzielony ekran:
`commit` przed renderem każdej połowy.

## 8. Dla 12-B (wpięcie w Core3D) — zrobione, stan w §10–§12

Lista 12-A (krok compute, `FxPoolOrigin` / `LightGrid` jako pola Core3D, `GridLighting`, pomiar pętli siatki, „uber” ze
źródłami i warstwą DIST, siatka NaN, rozgrzewka, Fx3D w TSL, ziarno `fxRandom` w harnessie) — wykonana w 12-B; różnice
względem planu: system oświetlenia PRZED `renderer.init()` (nie „przed pierwszym renderem”), znak osi y warstwy DIST
(§10), rozgrzewka przez `warm` kroków + `prewarmPass` zamiast pustej klatki przez post (post i tak kompiluje się w
pierwszej klatce tła menu).

## 9. Dla 17 / 19 / 21

Wszystko przez `Core3D` (§10): jeden egzemplarz `Core3D.fx.origin` / `.grid` / `.lights` / `.distortion`, zegar
`ctx.time` (= `Core3D.fx.time`), kroki `Core3D.addFxStep(...)`.

- **17 (broń):** `gpuFx` z dema jako krok (`spawn` — wysyłka paczek i dispatch kernela spawn, `update` — kroki pul,
  `lights` — pociski / wiązki jako `ctx.grid.addWorld`, `warm` — puste dispatche + `Core3D.prewarmPass(siatka, 0)`), pule
  na `Core3D.fx.origin` (pozycje lokalne, czasy `timeFx`, `createShiftKernel` + `origin.register({ shiftNode, isLive })`
  po głowie pierścienia / czasie najdłuższego życia; siatki pul na `mesh.position.set(origin.x, origin.y, 0)`), paczka
  +vec4 nośnika (`writeCarrierPacket(…, origin.simEpoch)`), `ctx.lights` dema → `Core3D.fx.lights.flash / point`
  (opcje pozycyjnie), `rand` / `E()` → `fxRandom` (`round` dla emiterów ciągłych), szum `fxNoise.tile2D()`. Fale i
  drganie: `Core3D.fxDistortion().shock / heat(...)` (analitycznie) albo pula DIST dema na `FX_DISTORT_LAYER` +
  `Core3D.setDistortLayerActive(żywa)` — materiał DIST pisze px w osiach sceny (jak demo), aberracja w „uber”.
- **19 (rakiety):** `SmokeSystem` jako krok (emisja w `spawn`, krok i światło w `update`), czyta `ctx.grid.loop(P_lokalne,
  …)` w compute (`grid.lightNode` / `indexNode` — 2 bufory storage, tylko odczyt), `noiseTex` → `fxNoise.curl3D /
  noise3D / cloud2D`, `post.add(typ, …)` → `Core3D.fxDistortion().add(...)` (świat gry zamiast `sx/sy`), stały początek O
  dema → `Core3D.fx.origin`. Mapa gęstości dymu (cel HalfFloat, własny kontekst renderu) rozgrzewana w `warm`.
- **21 (asteroidy):** `lights.js` dema → `Core3D.fx.grid` (to samo API `add` / `build` / `loop` / `shadows` /
  `addShipLights(grid, e, L, ox, oy, opts)` z `ox = grid.worldOriginX`) — światła statków w `lights(ctx)` kroku, mapy
  cienia (`grid.shadows`) przed pierwszą budową materiałów; `REBASE_DIST` dema = `FX_REBASE_DIST`. Materiały skał z
  `enableGridLights(mat, owner)`. `SurfaceLightingModel` (kopie w 3 demach) nie wchodzi do 12 — przy materiale kadłuba
  (18) / skał (21).
- **18 (kadłuby):** `HullNodeMaterial` ma własny model oświetlenia (`lights = false`) — siatkę czyta jawnie
  `grid.loop(grid.localPosition(), …)` w grafie kadłuba (hak `hullEffectLights`) albo przez `enableGridLights` przy
  przejściu na `lights = true`; właściciel (`gridLightOwner` = `uniform().onObjectUpdate`) pomija własne lampy statku.

## 10. Wpięcie w Core3D (12-B)

`Core3D.fx` = `FxFrame` (`src/3d/fx/fxFrame.js`), tworzony w `Core3D.init()` (przeżywa ponowny init).

**Klatka** (`Core3D._runFxFrame`, zaraz po `_beginRenderInfo()` w `render()`, przed maską słońca i passami scen; raz na
klatkę rAF — `renderer.info.frame`, więc drugi `renderSingle` podzielonego ekranu nic nie robi):

1. `spawn(ctx)` kroków (stara rama początku),
2. `origin.update(kamera sceny, fx.time, SimClock.sim, SimClock.render)` — kamera gracza 1 (wolna kamera: pozycja
   kamery perspektywicznej),
3. `origin.dispatch(renderer)` — kernele przesunięcia żywych pul (tylko po przeskoku),
4. siatka: `grid.begin(origin)` → `setBounds(kadr lokalnie)` — kadr kamery z zapasem `FX_VIEW_MARGIN` (15%), w
   podzielonym ekranie suma kadrów obu graczy (`window.camera2`), wolna kamera ±12 tys. j. → `fx.lights.commit(grid,
   time)` (tylko gdy są błyski / punkty; **starzenie PO zapisie**: błysk zgłoszony w tej klatce świeci od wieku 0, jak w
   demie broni) → `lights(ctx)` kroków → `grid.build()` — pusta siatka dwa razy z rzędu = bez budowy i bez wysyłki,
5. `update(ctx)` kroków.

`ctx` (jeden obiekt na grę): `renderer`, `core`, `time`, `dt`, `frame`, `origin`, `grid`, `lights`, `distortion`, `view`
(kadr w świecie gry). Zegar efektów `fx.time`: klatka rAF z `performance.now()` (krok ≤ `FX_MAX_DT` = 0,1 s, biegnie też
w pauzie — jak `Fx3D.time`; w harnessie wirtualny). **Rozgrzewka:** `warm(ctx)` kroku raz przy gotowym urządzeniu
(`Core3D._initGpu` → `fx.warmAll()`) albo od razu przy rejestracji po nim; `warmAll` rozgrzewa też kernele przesunięcia
zarejestrowanych pul (dispatch z zerowym przesunięciem). Siatki warstwy DIST `prewarmPass(siatka, FX_DISTORT_LAYER)`
kompiluje na `distortionTarget` (inny kontekst renderu niż `composerTarget`).

**Zniekształcenia** (`Core3D._renderFxDistortion`, na KAŻDY render przed postem): `fx.commitDistortion(kamera tego
renderu, rozmiar celu sceny)` — źródła z `Core3D.fxDistortion()` (świat gry; kolejka żyje do końca klatki, kasuje ją
pierwsze zgłoszenie po renderze albo render następnej klatki bez zgłoszeń); wolna kamera, tło menu i
`perfToggles.fxDistortion = false` → 0 źródeł. Warstwa DIST (`FX_DISTORT_LAYER` = 10; 8 = nowy warp, 9 = tło menu):
gdy właściciel zgłosił zawartość (`Core3D.setDistortLayerActive(true)` — co klatkę), pass kamery ortho do
`Core3D.distortionTarget` (RGBA HalfFloat — od 2026-10-05, wcześniej RG; RG = przesunięcie, B / A — heksy-ekrany
maskowania i znacznik refrakcji kadłuba, inne źródła piszą 0; bez MSAA i głębi, rozmiar bufora sceny; czyszczony co pass)
i `uDistLayerOn = 1`.
„Uber” (`postGry.js`): gałąź efektów tylko przy źródłach (licznik bloku > 0) albo warstwie — inaczej dawna ścieżka dysz z
02 co do instrukcji (obraz bit w bit, kontrola A). W gałęzi: przesunięcie `DistortionField` (część z dyspersją ×0,82 /
×1 / ×1,22 jak dysze) + warstwa DIST: przesunięcie w px w osiach SCENY (x w prawo, y w górę) → próbka z `p − o` w osiach
sceny w OBU osiach (UV: `uv + (−o.x, +o.y) / rozmiar`; **demo broni odejmowało `o` od `screenUV` wprost — w osi y
kierunek był odwrócony względem osi x**; kontrola D), aberracja warstwy ×1,12 / ×1 / ×0,88 jak w demie. Scena i bloom
próbkowane tym samym przesuniętym UV (jak gorące powietrze). Bez clampów (jak demo).

**Siatka bezpieczeństwa** (`hdrBezpieczny`, `postGry.js`): NaN i ±Inf → 0 per składowa (bity wykładnika), na wejściu
bloomu (`BloomGry(hdrBezpieczny(texture(scena)))`) i na każdym odczycie sceny w „uber”. Skończone wartości bez zmian
(też ujemne).

**Alokacje:** bez obiektów na klatkę i na światło (zakresy wysyłki buforów siatki na stałe — `LightGrid`, 12-B); zostaje
pakowanie liczb double przez V8 przy wywołaniach nieinlinowanych (`uniform.value = liczba` w `FxPoolOrigin.update`,
argumenty `grid.addWorld`) — ~150 B stałe na klatkę i kilka–kilkanaście B na światło (test w `fxCore3D.test.mjs`).

**Pomiar:** `Core3D.fxStats` (`cpuMs`, `dispatches` — `renderer.info.compute.frameCalls` klatki, `steps`, `lights`,
`gridItems`, `gridBuilt`, `distortSources`, `distortLayer`), GPU compute — `Core3D.gpuComputeMs` (znaczniki czasu);
PerfHUD: wiersz „Efekty GPU”; harness: `perf().fx` i `gpuComputeMs` w `wyniki.json`, `--wydajnosc`: `fxMs`,
`gpuCompute`.

## 11. Fx3D w TSL (12-B)

`src/3d/fxParticles3D.js`: dawny `ShaderMaterial` (67 linii GLSL) → `FxQuadMaterial` na **czterech grafach wierzchołków**
(BB — bilboard obrócony w widoku; PLUME — wzdłuż osi lufy, obrócony ku kamerze; CROSS — oś X wzdłuż lufy na ekranie;
WASH — płasko w płaszczyźnie gry) i **jednym grafie fragmentu** (tekstura × barwa, odrzucenie przy alfie < 0,002),
budowanych raz na moduł. Siedem systemów kwadów ma cztery programy (dym, opary, poświata i gwiazda — wspólny klucz
BB); różni je tekstura (per obiekt: `FxMapNode` — `TextureNode` z `updateType` OBJECT czyta
`material.uniforms.map.value`, zastępcza 1 × 1 biała z filtrem liniowym) i mieszanie (stan pipeline'u). Wzory 1:1
(`modelViewMatrix` z kontekstu — `highPrecision`, pozycje względem początku przy kamerze jak dawniej). Łuki i iskry
(`LineBasicMaterial`, nazwy `Fx3D:arcs` / `Fx3D:sparks`) konwertuje biblioteka WebGPU. Wysyłka tylko żywej części
atrybutów (zakres na stałe, bez alokacji; iskry dawniej 5200 × 6 liczb × 2 atrybuty co klatkę). API banku bez zmian
(`spawn`, `update`, `time`, `lastDt`, `addUpdater`, `setCarrier`, `meshes`, …).

Znalezione przy porcie (bez zmian, 1:1): kwady **WASH są tyłem do kamery** (baza `r = (−f.y, f.x)`, `f` → wyznacznik
ujemny → trójkąty CW, `FrontSide` je odrzuca) — „rozlanie światła po poszyciu” nie rysowało się też na WebGL. Iskry i łuki
(linie 1 px) rasteryzują się w Dawn inaczej niż w ANGLE / D3D11 (przesunięcie o piksel, bez ujemnych wartości HDR,
które WebGL dawał na brzegach linii) — `silniki.mjs` z bankiem Fx3D: bufor HDR bitwa 0,016% pikseli > 8/255, gracz
(dopalacz, dużo iskier) 0,067%.

## 12. Kontrola na GPU i pomiary (12-B)

`node scripts/webgpu/efekty-kontrola.mjs [--out …] [--port …] [--ref a72b8fa]` — w prawdziwej grze, wynik w
`<out>/wynik.json`, kod wyjścia 1 przy porażce. Wynik 2026-09-28 (RTX 5080, 1920 × 1080): wszystkie kontrole OK —
A: „uber” bez źródeł = „uber” z 02 co do bitu (0 różnych pikseli na buforze bitwy z 7 źródłami gorącego powietrza
dysz); B: kwad 40 px z NaN / +Inf w buforze sceny — z siatką zmienia tylko swoje 1600 px, bez niej (post z 02) NaN przez
bloom zalewa 1 780 920 px (cały kadr); C: fala tylko w zasięgu R + 3,2 w, drugi render tej klatki identyczny,
następna klatka 0 źródeł; D: warstwa DIST (8, 0) px → obraz przesunięty o 8 px w prawo, (0, 8) → 8 px w górę,
wyłączona = bez zmian; E: `MeshStandardMaterial` z `gridLights` przy pustej siatce = bez flagi co do bitu, światło
efektu +9,3% jasności kuli tylko w zasięgu; F: krok compute — rozgrzewka przy rejestracji, kolejność spawn → lights →
update, 1 dispatch w klatce, dane kernela = zegar efektów.

Koszt pustej infrastruktury (bez kroków, świateł i źródeł): CPU klatki efektów 0–0,01 ms (mediana 0,005 ms), 0
dispatchy, 0 wysyłek siatki; w „uber” gałąź efektów się nie wykonuje (jeden odczyt uniformu). Bitwa `--wydajnosc`
(24 × 24 okręty) — patrz dziennik zadania w `POSTEP.md`.
