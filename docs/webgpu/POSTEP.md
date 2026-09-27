# Port WebGPU — postęp

> Plik ciągłości między sesjami. Każda sesja zaczyna od niego i kończy na nim:
> co zrobione, commit, co dalej. Stan zadań portu — tabela „Zadania portu”; świadome regresje
> przejściowe — sekcja niżej; dziennik sesji na końcu. Jak prowadzić zadania: `README.md`.

## Decyzje użytkownika (obowiązują cały port)

| Data | Decyzja |
|---|---|
| 2026-09-27 | **Jedna ścieżka renderu: WebGPU + TSL, GLSL usuwamy** (zmiana `PROMPT-START.md`, zasada 2). Bez dwóch równoległych ścieżek do końca portu. |
| 2026-09-27 | **Praca na `main`** (zasada 7); użytkownik ma lokalny backup (rar). |
| 2026-09-27 | **Warp poza portem** — stara soczewka do wyrzucenia, nowy warp (`dema/warp-demo.html`) wejdzie później od razu w TSL (`PROMPT-START.md` § Warp, `USTALENIA.md` §7). |
| 2026-09-27 | **Asteroidy poza portem** — nowe są gotowe w `dema/asteroidy.html` (i demo WebGPU `dema/asteroidy-webgpu.html`), więc starych nie przenosimy. |
| 2026-09-27 | **Stare pole asteroid WYŁĄCZONE w całości na czas portu** (rozgrywka i wygląd; odpowiedź na pytanie w Fazie 0). Wdrożone: `OLD_ASTEROIDS_ENABLED` w `index.html` (przy tworzeniu `AsteroidField` / `AsteroidBeltBackdrop`), `?asteroidyStare` przywraca je (pełny obraz tylko na tagu — na `main` od zadania 01 ich materiały są zamiennikami). Wszystkie haki gry znoszą brak pola. |
| 2026-09-27 | **Dema spoza gry zostają na tagu `webgl-baseline`** (odpowiedź na pytanie w Fazie 0): port obejmuje to, co ładuje gra, plus warsztaty przenoszonych modułów (`halo_ring_demo`, `mostki-demo`, `rdzen-demo`). `warp-demo`, `asteroidy.html`, `budowle-portowe` (Z7), `kontenery` (Z5), `scripts/proxy-batch` (Z4), `destruktor2d/3d` działają z tagu (osobny worktree); warp, nowe asteroidy i moduły Z4/Z5/Z7 przechodzą na TSL przy swojej integracji. |
| 2026-09-27 | Z listy zadań wypadły: Electron i build produkcyjny oraz przełączenie domyślnego backendu / polityka awaryjna (zmiana `PROMPT-START.md`). |

## Faza 0 — kroki

| Krok | Co | Status | Commit |
|---|---|---|---|
| 1 | Rozpoznanie (agents.md, USTALENIA, core3d.js, narzędzia CDP) | zrobione | — |
| 2 | Środowisko + testy bazowe | zrobione | (commit kroków 2–4) |
| 3 | Spike techniczny (`dema/webgpu-spike.*`, `SPIKE.md`) | zrobione — 17/17, bez blokad | (commit kroków 2–4) |
| 4 | Inwentarz (`scripts/webgpu/inwentarz.mjs` → `INWENTARZ.md`) | zrobione | (commit kroków 2–4) |
| 5 | Harness zrzutów + baza WebGL (`zrzuty.mjs`, `porownaj.mjs`, `baseline.json`) | zrobione — 48 zrzutów, szum ≤ 0,03% (>2/255), 0% (>8); tag `webgl-baseline` | (commit kroku 5) |
| 6 | Plan i zadania (`PLAN.md`, `zadania/NN-*.md`, `README.md`, sekcja w `agents.md`) | zrobione — 20 zadań + odłożony warp | (commit kroku 6) |
| 7 | Raport dla użytkownika | zrobione (w rozmowie); zadanie 01 czeka na zgodę | — |

## Zadania portu

Pliki: `zadania/NN-*.md`; kolejność i uzasadnienie: `PLAN.md` §9. Status: `czeka` → `w toku (sesja, data)` →
`zrobione` (commit). „Równolegle z” = rozłączne pliki, każda równoległa sesja we własnym worktree (`README.md`).

| # | Zadanie | Zależy od | Równolegle z | Effort | Status | Commit | Uwagi |
|---|---|---|---|---|---|---|---|
| 01 | Fundament: `WebGPURenderer` w Core3D, zamienniki, adapter uniformów, harness na WebGPU | — | nie | max | czeka na zgodę użytkownika | | od niego gra = magenta dla nieprzeniesionych materiałów |
| 02 | Post 1/2: bloom, pełny „uber”, pre-pass halo, MSAA, kalibracja tolerancji | 01 | 06 | max | czeka | | kalibruje `tolerancjaPortu` |
| 03 | Post 2/2: maska słońca, SDF kadłubów, refrakcja, fala uderzeniowa | 02 | 06 | max | czeka | | biblioteki dla 04–18 |
| 04 | Kadłuby (belki + heksy), lakier, impostory, szczątki | 03 | 05, 06–10, 12–14, 16, 17 | max | czeka | | graf na wariant zamiast materiału na encję |
| 05 | Planety, słońce, mgławica, gwiazdy, stacje | 03 | 04, 06–10, 12–14, 16, 17 | xhigh | czeka | | |
| 06 | Ring 1/5: biblioteka TSL, pieczenie map, odczyt asynchroniczny, `halo_ring_demo` | 01 | 02, 03, 04, 05, 12–14, 16, 17 | max | czeka | | kończy przejściową regresję terenu ringu z 01 |
| 07 | Ring 2/5: teren + zestaw przemysłowy | 06 | 04, 05, 12–14, 16, 17 | xhigh | czeka | | |
| 08 | Ring 3/5: struktura + atmosfera | 07 | j.w. | xhigh | czeka | | |
| 09 | Ring 4/5: megastruktura + miasto (kopuły, landmarki, drzewa) | 08 | j.w. | xhigh | czeka | | |
| 10 | Ring 5/5: K-7 + ringi-archetypy Marsa i Jowisza | 09 | j.w. | xhigh | czeka | | ring bez zamienników |
| 11 | Tło menu + rozgrzewka pipeline'ów | 05, 10 | 12–18 | max | czeka | | nowy `menuBackdrop.test` |
| 12 | Broń i cząstki w scenie Core3D | 03 | 04–10, 13, 14, 16, 17 | xhigh | czeka | | decyzja PLAN §12 p. 6 |
| 13 | Silniki: MAIN, WARP (plazma), SIDE | 03 | 04–10, 12, 14, 16, 17 | xhigh | czeka | | |
| 14 | Tarcze i trafienia w tarczę | 03 | 04–10, 12, 13, 16, 17 | xhigh | czeka | | |
| 15 | Mostki, rdzenie, reaktory, światła (+ `mostki-demo`, `rdzen-demo`) | 04 | 05–14, 16–18 | xhigh | czeka | | |
| 16 | Zniszczenie stacji (+ scena bazy `stacja-rozpad`) | 03 | 04–15, 17, 18 | xhigh | czeka | | |
| 17 | Overlay efektów na renderer Core3D (`CanvasTarget`), iskry, rakiety | 03 | 04–16 | max | czeka | | decyzja PLAN §12 p. 6 |
| 18 | Wybuchy, trafienia, Yamato | 17 | 04–16 | xhigh | czeka | | decyzja PLAN §12 p. 6 |
| 19 | Wydajność i precyzja: A/B z tagiem, drżenie, kompilacja, pamięć | 04–18 | nie | max | czeka | | |
| 20 | Sprzątanie i domknięcie portu | 19 | nie | xhigh | czeka | | decyzje PLAN §12 p. 1, 3 |
| — | Odłożone: nowy warp od razu w TSL (pass zgięcia tła w `Core3D.render`) | wpięcie nowego warpa | — | — | odłożone | | decyzja użytkownika |

## Regresje przejściowe (świadome)

Stan zamierzony na `main` w trakcie portu — nie „naprawiać” poza zadaniem, które go kończy.

| Od | Do | Co | Kończy |
|---|---|---|---|
| 01 | 20 | Nieprzeniesione `ShaderMaterial` rysują się magentą (`spis.zamienniki` w harnessie) | zadania 02–18 |
| 01 | 06 | Brak synchronicznego odczytu → mapa CPU ringu pusta (`heightAtUV` = 0): płyta ringu koliduje bez rzeźby terenu, LOD terenu bez wysokości, landmarki i kopuły stawiane bez mapy (stała wysokość z `haloRingLandmarks.js`) | 06 |
| 01 | 17 | Overlay efektów na własnym `WebGLRenderer` (jedyny drugi renderer) | 17 |
| 01 | — | Soczewka i fale warpa usunięte (API jako no-op), skok działa bez efektu zgięcia | nowy warp (odłożone) |
| Faza 0 | — | Stare pole asteroid i tło pasa wyłączone (`?asteroidyStare`) | integracja nowych asteroid |

## Środowisko (Krok 2, 2026-09-27)

Sonda: `node scripts/webgpu/srodowisko.mjs [--out plik.json]` (Vite + headless Chrome z flagami
`dema/rdzen-cdp.js`; adapter, cechy, limity, urządzenie z próbnym submit i znacznikiem czasu,
renderer WebGL2 dla porównania). Wynik JSON — do porównań na innych maszynach.

| Co | Wartość |
|---|---|
| System | Windows 11 Pro 10.0.26200 |
| CPU / RAM | AMD Ryzen 7 7800X3D / 31 GB |
| GPU | **NVIDIA GeForce RTX 5080**, sterownik 32.0.16.1088 (NVIDIA 610.88, 2026-07-22); obok iGPU AMD Radeon (Ryzen) |
| Node / npm | 22.20.0 / 11.6.2 (narzędzia CDP wymagają ≥ 22 — globalny `WebSocket`) |
| Chrome | 153.0.8010.54 (headless `--headless=new`, ANGLE D3D11 dla WebGL) |
| three | 0.183.2 (`npm install` — bez zmian w lockfile) |
| Adapter WebGPU | `nvidia` / `blackwell`, nie zapasowy; **`high-performance` i `low-power` dają ten sam adapter** (RTX 5080, nie iGPU) |
| Format canvasa | `bgra8unorm` |
| Cechy (wybrane) | `timestamp-query`, `float32-filterable`, `float32-blendable`, `shader-f16`, `rg11b10ufloat-renderable`, `texture-compression-bc`, `dual-source-blending`, `subgroups`, `clip-distances`, `depth32float-stencil8`, `texture-formats-tier1/2` |
| Urządzenie | próbny pass ze znacznikami czasu: 224 ns, bez błędów walidacji, urządzenie żyje po submit |
| WebGL2 (dziś) | ANGLE (NVIDIA RTX 5080, Direct3D11), `EXT_disjoint_timer_query_webgl2`, `EXT_color_buffer_float`, `EXT_float_blend` |

**Limity: domyślne urządzenie ≠ adapter.** Bez `requiredLimits` WebGPU daje minimum ze specyfikacji —
gra musi prosić o więcej (w demie asteroid WebGPU już tak jest):

| Limit | Domyślnie | Adapter | Dlaczego ważne w grze |
|---|---|---|---|
| `maxTextureDimension2D` | 8192 | 16384 | planety 8K, mapy ringu „Ultra” 16K |
| `maxTextureArrayLayers` | 256 | 2048 | tablice warstw (SDF kadłubów, skały) |
| `maxSampledTexturesPerShaderStage` | 16 | 48 | materiały ringu / planet z wieloma teksturami |
| `maxInterStageShaderVariables` | 16 | 28 | materiały z wieloma varyingami |
| `maxVertexAttributes` | 16 | 30 | instancje z wieloma atrybutami |
| `maxStorageBuffersPerShaderStage` | 8 | 16 | compute, pył |
| `maxStorageTexturesPerShaderStage` | 4 | 8 | |
| `maxColorAttachmentBytesPerSample` | 32 | 128 | MRT HalfFloat |
| `maxBufferSize` / `maxStorageBufferBindingSize` | 256 MB / 128 MB | 2 GB / 2 GB | |
| `maxComputeInvocationsPerWorkgroup` / `…WorkgroupStorageSize` | 256 / 16 KB | 1024 / 32 KB | |

## Testy bazowe (Krok 2, 2026-09-27, HEAD `cb02194`)

- `npm test` (= tylko `scripts/tests`, 32 zestawy): **OK — 1662 asercje, 0 błędów**.
- `node --test "tests/*.test.mjs"`: **1322 testy, 1313 OK, 7 porażek, 2 todo** (~23 s).
  Uwaga: `node --test tests/` na Node 22.20 NIE działa (`Cannot find module …\tests` — katalog nie jest
  już przeszukiwany); używać wzorca `"tests/*.test.mjs"`.

Porażki bazowe (znane sprzed portu — nie naprawiać w ramach portu):

| Test | Plik |
|---|---|
| billboard-oriented asteroid impacts map to the visible local side | `tests/asteroidHexAdapter.test.mjs:309` |
| HUD radar shell is compact and does not reserve an empty lower panel | `tests/hudRadarWiring.test.mjs:16` |
| HUD radar exposes clickable tactical range controls | `tests/hudRadarWiring.test.mjs:24` |
| X starts one scanner burst without scheduling recurring waves | `tests/scannerSingleBurst.test.mjs:5` |
| physical AU metadata does not collapse the stretched gameplay map | `tests/solarSystem.test.mjs:46` |
| targeting wheel exposes SINGLE, MULTI and SUB in the existing three sectors | `tests/targetingModes.test.mjs:14` |
| P1 index firing paths use the same simulated mount state as the shared controller (`MuzzleFX3D is not defined`) | `tests/weaponAim.test.mjs:144` |

Todo (2): „PORT poprawka 1 / 3 (TODO integracji)” w `tests/shipCore.test.mjs` (rdzenie, `docs/PORT-rdzen.md`).

## Dziennik sesji

### 2026-09-27 — Faza 0 (sesja 1)

- Krok 1: przeczytane `agents.md`, `USTALENIA.md`, `DEMO-ASTEROIDY.md`, `core3d.js` w całości,
  `drawHexShips3D`, `sunShadowMask.js`, `bloomConfig.js`, `sceneOrigin.js`, narzędzia CDP.
  Nowe względem `USTALENIA.md`: w grze są **jeszcze dwa renderery WebGL poza Core3D** —
  `src/effects3d/overlay.js:127` (`overlay3D` eksplozji z własnym composerem i bloomem oraz
  `rocketOverlay3D` rakiet; osobne kanwy nad `#c` z `mix-blend-mode: screen`) i narzędzie dev
  `src/3d/modelBaker.js` (z `src/ui/devTools.js`); legacy `planet3d.proc.js` też ma własny.
  three r183 ma `CanvasTarget` + `renderer.setCanvasTarget()` — jeden renderer może rysować do kilku kanw.
- Krok 2: środowisko i testy bazowe jak wyżej.
- Krok 3: spike — 17 punktów na RTX 5080, wszystkie działają w Vite i przez import map (`SPIKE.md`). Najważniejsze:
  model klatki Core3D (wiele `render()` do jednego celu MSAA) działa bez obejść WebGL; `CanvasTarget` wpina overlay
  w renderer Core3D; `highPrecision` + dotychczasowa reguła precyzji dają 0,001 px także dla `InstancedMesh`;
  WGSL (DXC) kompiluje się 2–9× szybciej niż ten sam GLSL przez ANGLE (pierwszy przebieg: 44 s = `mx_noise_float`
  rozwinięty 160× pętlą JS — do unikania); odczyty asynchroniczne z paddingiem 256 B i odwróconą osią Y; cień
  aktualizuje się najwyżej raz na klatkę; `clear()` ignoruje nożyczki.
- Krok 4: inwentarz — `node scripts/webgpu/inwentarz.mjs` → `INWENTARZ.md` (+ JSON w `.tmp/webgpu/`). Razem 117 miejsc
  tworzenia materiałów i ~14 tys. linii GLSL; **w porcie (ładuje gra, bez warpa i asteroid): 71 materiałów, 9061 linii
  w 44 plikach**; warp 364 linie, stare asteroidy 66, nowe asteroidy 1889, legacy `planet3d.proc.js` 392, poza grą 2226
  (dema: ładunek Z5, budowle Z7, proxy Z4, `beamShips3D` destruktorów). Graf importów pokazał: `beamShips3D`,
  `shipProxyBatch3D`, `voxelShips3D`, `cargoContainers3D`, `cargoDrones3D`, `portBuildings/*` NIE są w grze.
  Subagenci (dema, asteroidy, testy): gałąź heksów `hexShips3D` rysuje w grze tylko asteroidy; `coldWreckImpostors`
  uśpione; `DestructorGpuSoftBody` prosi o drugie urządzenie WebGPU co sesję; 5 dem na Core3D (warp, asteroidy,
  budowle, mostki, rdzeń) + 4 z własnym WebGLRenderer na modułach gry (ring, kontenery, destruktor 2D/3D).
- Pytania do użytkownika (odpowiedzi w tabeli decyzji): stare asteroidy → wyłączyć całe pole; dema spoza gry → tag.
- Krok 5: harness zrzutów prawdziwej gry.
  - Narzędzia: `scripts/webgpu/zrzuty.mjs` (sesje i sceny), `harness-strona.js` (wstrzykiwany przed skryptami
    strony), `porownaj.mjs` (porównanie katalogów: % pikseli > 2/8/32, średnia, maks, mapa różnic, obok siebie),
    `png.mjs` (PNG bez zależności), `baza.mjs` (składa `baseline.json`).
  - **Determinizm bez zmian w grze** (droga dojścia — zapisana, bo to łatwo zepsuć): zegar wirtualny
    (`performance.now`, `Date.now`, znacznik rAF) stoi od wczytania, sceny kroczą go o 1/60 s na klatkę;
    **stała baza czasu** (10 000 ms, nie `realNow()` — z bazą z chwili wczytania porównania `now − lastShot ≥ cooldown`
    rozstrzygały się o klatkę inaczej i pociski się rozjeżdżały); `Math.random` z ziarnem (mulberry32), **ponowne
    ziarno na starcie każdej sceny i przed krokami** (spawny losują rozrzut, a klatki ładowania zużywają losowania
    w zmiennej liczbie); **dyspozytor rAF „hold”** — strona dostaje klatki tylko na żądanie harnessu (efekty liczone
    na klatkę: iskry warpa, obrót stacji); **sprite'y kadłubów wczytane z góry** (kadłub NPC powstaje w
    `drawNPCPretty`, gdy sprite gotowy — inaczej kolejność tworzenia ciał zależy od sieci); CSS bez animacji.
    Efekt: dwa przebiegi WebGL różnią się ≤ 0,007% pikseli (> 2/255), bitwa co do bitu.
  - Haki w `index.html` (tylko `?dev`, rozgrywki nie zmieniają): `window.DevScene.teleport(x, y, kurs)`,
    `.syncCamera()` (RTS rysuje się z interpolacji `prevCameraState` zapisywanego w krokach fizyki),
    `.preloadHullSprites()`, `.startSplit()` (podzielony ekran bez padów).
  - Sceny (16 + 32 warianty warstw = 48 PNG): `menu`, `hud`, `ring-z02`, `ring-z1`, `k7-hala`, `planeta-cien`
    (Wenus i jej cień), `slonce`, `mars-ring` (ECUMENE), `jowisz-ring` (Fable), `kalibracja` (same wbudowane
    materiały three: Standard, emisja HDR, Basic HDR, addytywny, gradient sRGB, alfa — wariant `__ortho` nie ma
    zamienników już po zadaniach 01–02, na nim zadanie 02 kalibruje tolerancję), `bitwa`, `bitwa-blisko`, `wybuch`,
    `wraki`, `warp` (ładowanie, plazma WARP), `split`; warianty „jedna warstwa” (`scena__tlo|planety|ortho|fg`) dla
    ring-z02, k7-hala, planeta-cien, mars-ring, jowisz-ring, kalibracja, bitwa, wraki — harness owija `renderer.render` i pomija passy spoza warstw (Core3D `setPerfToggles` z `bgPass: false`
    zostawia starą klatkę — tylko pass tła czyści kolor). Każda scena: PNG, błędy/ostrzeżenia konsoli (z walidacją
    WebGPU przez domenę Log), draw calle i trójkąty (per pass), ms CPU `Core3D.render`, ms GPU, histogram HDR bufora
    sceny, spis widocznych materiałów per warstwa (na WebGPU policzy zamienniki), stan świata.
  - Pominięte względem prompta: gęste pole asteroid i burza pasa (asteroidy poza portem), mostek 3D z bliska
    (mostki na kadłubach belkowych nieaktywne — weryfikacja w `dema/mostki-demo.html`).
  - Baza: `node scripts/webgpu/zrzuty.mjs --backend webgl --powtorz 2 --wydajnosc --out .tmp/webgpu/baseline`
    → PNG w `.tmp/webgpu/baseline/webgl/p1` (+ `p2`, `szum-p1-p2/`), `node scripts/webgpu/baza.mjs` →
    `docs/webgpu/baseline.json`. Wydajność (bitwa 24×24, 1920×1080, headless): klatka 3,6–4,9 ms, fizyka 0,5–1,0,
    rysowanie 2,4–3,0, render Core3D 0,87–1,03 ms CPU, GPU 1,0–1,1 ms, 87–88 draw calli — rozrzut między
    przebiegami, bo inne sesje użytkownika pracowały na tym samym GPU/CPU; porównanie wydajności (zadanie 19) tylko
    naprzemiennie i bez innych obciążeń. Drżenie (`dema/precyzja-drzenie.js
    --variant po`): światła 0,003 px RMS, okna mostków 0,04–0,06 px, reszta ≈ 0.
  - Testy po hakach: bez zmian (7 porażek bazowych, `npm test` OK).
- Krok 6: `PLAN.md` (architektura z wyników spike'u, konwencje TSL, precyzja, cienie, asynchroniczność, weryfikacja,
  20 zadań + odłożony warp, ryzyka, pytania), `zadania/01…20`, `README.md`, sekcja „Port WebGPU (w toku)” w `agents.md`,
  tabela zadań i regresji przejściowych wyżej. Narzędzia: `baza.mjs --dopisz` (nowa scena bazy z tagu bez przebudowy
  całości) i ochrona skalibrowanej tolerancji przy przebudowie (sprawdzone na kopii: pełna przebudowa daje plik
  identyczny poza datą; dopisanie sceny + ponowna przebudowa ją zachowują). Ustalenia z planowania (źródło three r183
  albo sprawdzone w Node):
  - **Scena overlay** (osobny `WebGLRenderer` do 17) zawiera też **iskry** `SparkSystem3D` (`index.html:
    SparkSystem3D.init(ov.scene)`) — materiału w niej nie da się przenieść przed przeniesieniem overlaya, więc iskry są
    w 17 (nie w 12), wybuchy w 18. `rdzen-demo` ma własny overlay.
  - **Materiał na encję = budowa NodeBuilder na encję:** klucz materiału węzłowego to id węzłów — dwa materiały z
    osobnymi `uniform()` mają różne klucze, `clone()` i wspólny graf ten sam, `SpriteMaterial` o różnych kolorach ten
    sam (sprawdzone w Node, `customProgramCacheKey`). Dziś materiał na encję mają kadłuby, tarcze i plazma WARP →
    graf na wariant + `onObjectUpdate` (PLAN §3; zadania 04, 13, 14).
  - **`compileAsync` odtwarza pass:** pomija niewidoczne, spoza warstw kamery i spoza frustum, kompiluje dla bieżącego
    celu (format, MSAA) → rozgrzewka = cel `composerTarget` + kamera passa z warstwą (PLAN §6; pomocnik w 01).
    Trzymacze programów nadal potrzebne (`NodeManager` usuwa stan przy `usedTimes === 0`).
  - **Światła:** klucz materiałów oświetlanych zawiera id każdego widocznego światła (`LightsNode.customCacheKey`) —
    nie przełączać `visible` w biegu (dziś światła silników i trafień i tak wyłączone).
  - `Texture.updateRanges` backend ignoruje (tekstura obrażeń mostków 768 × 512 = 1,5 MB na zmianę — zadanie 15);
    zakresy atrybutów działają (`WebGPUAttributeUtils`). Kanwa WebGPU tylko premultiplied → overlay (dziś
    `premultipliedAlpha: false`) oddaje `kolor · alfa` (17). `three/webgpu` + `three/tsl` ładują się w Node (testy
    mogą czytać graf).
  - Gałąź heksów `hexShips3D` przechodzi w 04 (stoją na niej `mostki-demo`, `rdzen-demo` i pomiar drżenia), a
    `reactor3D` / `coreFx3D` w 15 (warsztat `rdzen-demo`) — zgodnie z decyzją o warsztatach; notatka inwentarza poprawiona.
  - Sesje równoległe tego dnia budują od nowa na WebGPU efekty broni (`dema/bronie-webgpu`), rakiet
    (`dema/rakiety-webgpu`) i warpa (`dema/warp-webgpu`) — pytanie do użytkownika (PLAN §12 p. 6); plan zakłada port 1:1.
- Krok 7: raport dla użytkownika w rozmowie; zadanie 01 czeka na zgodę.
