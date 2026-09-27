# Infrastruktura efektów GPU — `src/3d/fx/` (zadanie 12-A)

> 2026-09-27, część 12-A zadania 12: czyste moduły wspólnej infrastruktury nowych efektów (broń 17–18, rakiety 19,
> asteroidy 21), **bez wpięcia w Core3D** (to 12-B). Testy: `tests/fxLightGrid.test.mjs`, `tests/fxInfra.test.mjs`
> (grafy TSL budowane do WGSL w Node). Stan dem, z którego scalono: `dema/asteroidy-webgpu/lights.js` — kopia robocza
> z `main` 2026-09-27 (niezacommitowana, sesja dema trwa; baza w repo: 5e4001d), `dema/bronie-webgpu/*` — 3a0c5b2,
> `dema/rakiety-webgpu/*` — 174b271.

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

`GridLighting(grid, { mode, positionMode })` → `renderer.lighting` (przed pierwszym renderem sceny; własna mapa
scena → węzeł, bo bazowy `Lighting` trzyma ją w zmiennej modułu i zostawiłby węzeł poprzedniego systemu):

- `mode: 'optIn'` (**zalecany w grze**) — siatkę czytają tylko materiały z `gridLights === true`
  (`enableGridLights(mat, owner)`); flaga jest zwykłym polem materiału, więc wchodzi do klucza programu. Materiał bez
  flagi ma **WGSL identyczny jak bez `GridLighting`** (test) — planety, tło, stacje, ring i kalibracja bez zmian kodu
  i obrazu. Kadłuby włączą ją w 18, dym rakiet czyta ją w compute (19).
- `mode: 'all'` — jak dema: każdy oświetlany materiał poza `gridLights === false`.
- Właściciel: `enableGridLights(mat, uniform(0).onObjectUpdate(({ object }) => …))` — JEDEN węzeł na wariant materiału
  (wspólny graf = wspólny program, PLAN §3); pole `lightOwner` z dem też działa.

Koszt pętli w passie ortho (ms GPU przy pustej siatce i w bitwie) — do zmierzenia w 12-B na GPU; w Node sprawdzona
tylko struktura: +2 bufory storage, pętla po liście komórki (pusta siatka = 0 iteracji).

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

## 8. Dla 12-B (wpięcie w Core3D)

- `Core3D`: lista kroków compute raz na klatkę przed passami scen (kubełek PerfHUD, zero alokacji) z kolejnością z §6;
  `FxPoolOrigin` i `LightGrid` jako pola Core3D (jeden egzemplarz), `renderer.lighting = new GridLighting(grid)` przy
  tworzeniu renderera (przed pierwszym renderem); pomiar pętli siatki w passie ortho (pusta siatka / bitwa).
- „uber”: `off = distortionOffset(field.node, uv)` dodane do przesunięcia gorącego powietrza gry albo
  `sampleDistorted`; `field.commit` w `render()` z kamerą passa; warstwa DIST dema broni (cel renderu z przesunięciem w
  pikselach w RG) — jeśli 17 jej użyje: demo próbkuje `screenUV − dist.rg / screenSize`, więc w „uber”
  `off.xy − dist.rg / rozmiar` (demo pisze przesunięcie w osiach kwadu, y w górę, a UV ekranu ma y w dół — znak osi y
  do sprawdzenia przy porcie).
- Siatka bezpieczeństwa NaN/Inf przed bloomem, rozgrzewka (pusta klatka przez post + puste dispatche), Fx3D w TSL 1:1
  — poza 12-A.
- Harness: `window.fxRandom.seed(v)` przy `H.reseed`.

## 9. Dla 17 / 19 / 21

- **17 (broń):** `gpuFx` z dema na `FxPoolOrigin` (pozycje lokalne, czasy `timeFx`, kernel `createShiftKernel` na
  pule, rejestracja z `isLive` po głowie pierścienia / czasie najdłuższego życia), paczka +vec4 nośnika
  (`writeCarrierPacket`), `ctx.lights` → `FxLights` (opcje pozycyjnie), `rand` / `E()` → `fxRandom` (`round` dla
  emiterów ciągłych), szum `fxNoise.tile2D()`, pula DIST / fale → `DistortionField`.
- **19 (rakiety):** `SmokeSystem` czyta `grid.loop(P_lokalne, …)` w compute, `noiseTex` → `fxNoise.curl3D / noise3D /
  cloud2D`, `post.add(typ, …)` → `DistortionField.add` (świat gry zamiast `sx/sy`), stały początek O dema →
  `FxPoolOrigin`.
- **21 (asteroidy):** `lights.js` dema → `lightGrid.js` (to samo API `add` / `build` / `loop` / `shadows` /
  `addShipLights(grid, e, L, ox, oy, opts)` z `ox = grid.worldOriginX`), `REBASE_DIST` dema = `FX_REBASE_DIST`.
  `SurfaceLightingModel` (kopie w 3 demach) nie wchodzi do 12-A — przy materiale kadłuba (18) / skał (21).
