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
| 2026-09-27 | **Odpowiedzi na pytania planu (PLAN §12):** usuwać nieużywany kod, „przechodzimy w pełni na WebGPU”; **tylko WebGPU** (bez zapasu WebGL2 — komunikat); `modelBaker.js` usunąć; bez pushowania (użytkownik ma kopię na bieżąco, nie sprawdza po drodze); inne sesje skończyły — port prowadzi jedna sesja (z podagentami); **obrażenia i mechanika broni z dema wchodzą do rozgrywki** (mapa ran, przebicia, rykoszety, ładowanie, serie — zadanie 18); demo fizyki belek na GPU — później; warp czeka na poprawiony „Nurt” (osobna sesja). Cel końcowy: gra działa na WebGPU z nowymi brońmi, rakietami i ringiem. |
| 2026-09-27 | **Asteroidy i warp też wchodzą** („asteroidy zaraz będą production ready — zielone światło”, „warp też będzie ready do wgrania, jak skończy sesję”): zadania 21 (asteroidy z `dema/asteroidy-webgpu`) i 22 (warp „Nurt” z `dema/warp-webgpu`) po zakończeniu sesji dem; wydajność → 23, sprzątanie → 24. **Praca samodzielna do końca** („zostawiam ciebie samopas, od teraz rządzisz”); po wdrożeniu wszystkiego (WebGPU w grze, bronie, rakiety, asteroidy, warp, ringi) — **wyłączyć komputer** (po sprawdzeniu, że wszystko zacommitowane, a inne sesje bezczynne). |
| 2026-09-27 | **Nowe efekty broni i rakiet wchodzą przy porcie** (po obejrzeniu dem: „bronie — wszystkie super”, „rakiety — super”, „można je śmiało wdrażać przy okazji skoku na WebGPU”): efekty z `dema/bronie-webgpu` i `dema/rakiety-webgpu` zastępują stare efekty broni, trafień, iskier, rakiet i Supernowej zamiast portu 1:1. Plan przebudowany: 12 = infrastruktura efektów, 17–18 = broń, 19 = rakiety, 20 = koniec overlaya (22 zadania). Rozgrywka bez zmian. |

## Faza 0 — kroki

| Krok | Co | Status | Commit |
|---|---|---|---|
| 1 | Rozpoznanie (agents.md, USTALENIA, core3d.js, narzędzia CDP) | zrobione | — |
| 2 | Środowisko + testy bazowe | zrobione | (commit kroków 2–4) |
| 3 | Spike techniczny (`dema/webgpu-spike.*`, `SPIKE.md`) | zrobione — 17/17, bez blokad | (commit kroków 2–4) |
| 4 | Inwentarz (`scripts/webgpu/inwentarz.mjs` → `INWENTARZ.md`) | zrobione | (commit kroków 2–4) |
| 5 | Harness zrzutów + baza WebGL (`zrzuty.mjs`, `porownaj.mjs`, `baseline.json`) | zrobione — 48 zrzutów, szum ≤ 0,03% (>2/255), 0% (>8); tag `webgl-baseline` | (commit kroku 5) |
| 6 | Plan i zadania (`PLAN.md`, `zadania/NN-*.md`, `README.md`, sekcja w `agents.md`) | zrobione — 24 zadania (po decyzjach o nowych efektach, asteroidach i warpie) | 30e76b9 + przebudowa |
| 7 | Raport dla użytkownika | zrobione (w rozmowie); zadanie 01 czeka na zgodę | — |

## Zadania portu

Pliki: `zadania/NN-*.md`; kolejność i uzasadnienie: `PLAN.md` §9. Status: `czeka` → `w toku (sesja, data)` →
`zrobione` (commit). „Równolegle z” = rozłączne pliki, każda równoległa sesja we własnym worktree (`README.md`).

| # | Zadanie | Zależy od | Równolegle z | Effort | Status | Commit | Uwagi |
|---|---|---|---|---|---|---|---|
| 01 | Fundament: `WebGPURenderer` w Core3D, zamienniki, adapter uniformów, harness na WebGPU | — | nie | max | zrobione, scalone (159dd42) | fca136a, b9c95d2, be4ea80 | gra na WebGPU; magenta = nieprzeniesione; harness `--uuid osobne` + nowa baza (dziennik) |
| 02 | Post 1/2: bloom, pełny „uber”, pre-pass halo, MSAA, kalibracja tolerancji | 01 | 06 | max | zrobione, scalone (eb9370b) | a72b8fa, 777f86b, 77eef2b | `tolerancjaPortu` >8/255 ≤ 0,05%, średnia ≤ 0,03; `BloomNode` ×3 (zgodność z `UnrealBloomPass`); bloom ~1 ms CPU → 23 |
| 03 | Post 2/2: maska słońca, SDF kadłubów, refrakcja, fala uderzeniowa | 02 | 06 | max | w toku (podagent, worktree `statki-wt/03`; podmienia też zastępnik maski z 04) | | biblioteki dla 04–20 |
| 04 | Kadłuby (belki + heksy), lakier, impostory, szczątki | 03 | 05–14, 16, 19 | max | zrobione, scalone (f7c3c77, poprawka 9841cbf); maska słońca = zastępnik `// AGENT: po 03` w `hexShips3D.tsl.js` (podmienia 03) | 3adcc5c, 7599a42 | graf na wariant (spawn 30 NPC 14 ms zamiast 389); haki `hullDamageSurface/Heat`, `hullEffectLights` (18), `hullVolume` (21) |
| 05 | Planety, słońce, mgławica, gwiazdy, stacje | 03 | 04, 06–10, 12–20 | xhigh | w toku (podagent, worktree `statki-wt/05`; maska = zastępnik do 03, tolerancja `planeta-cien` po 03) | | |
| 06 | Ring 1/5: biblioteka TSL, pieczenie map, odczyt asynchroniczny, `halo_ring_demo` | 01 | 02–05, 12–20 | max | zrobione, scalone (070a407) | b7ecdc9…88d8df5 | kończy przejściową regresję terenu ringu z 01 |
| 07 | Ring 2/5: teren + zestaw przemysłowy | 06 | 04, 05, 12–20 | xhigh | zrobione, scalone (f735076) | 7b43733…96baa16 | |
| 08 | Ring 3/5: struktura + atmosfera | 07 | j.w. | xhigh | zrobione, scalone (979ed52) | 2c87915…fa8389b (scalenie `main` 60c7e4c) | nowe sceny bazy `ring-dach`, `ring-dach-z01`, `ring-habitat` (dopisane z tagu) |
| 09 | Ring 4/5: megastruktura + miasto (kopuły, landmarki, drzewa) | 08 | j.w. | xhigh | w toku (podagent, worktree `statki-wt/09`) | | |
| 10 | Ring 5/5: K-7 + ringi-archetypy Marsa i Jowisza | 09 | j.w. | xhigh | czeka | | ring bez zamienników |
| 11 | Tło menu + rozgrzewka pipeline'ów | 05, 10 | 12–20 | max | czeka | | nowy `menuBackdrop.test` |
| 12 | Infrastruktura efektów GPU: compute w klatce, siatka świateł, zniekształcenia, Fx3D w TSL | 03 | 04–11, 13–16 | max | 12-A zrobione i scalone (moduły `src/3d/fx/`); 12-B (wpięcie w Core3D, Fx3D w TSL) w toku (podagent, worktree `statki-wt/12b`, równolegle z 03 — zmiany `core3d.js` zwarte, scala `main` po 03) | 0f3d429…37953a6 | podstawa pod 17–19 (i przyszłe asteroidy) |
| 13 | Silniki: MAIN, WARP (plazma), SIDE | 03 | 04–12, 14–20 | xhigh | zrobione, scalone (bd96586) | e844a7a, c85042f, 3ff03a4 (scalenia `main` 23ed7d5, 49e7fdf) | graf plazmy na pulę (0 budów przy skoku); iskry MAIN = Fx3D (sprawdzić po 12-B: `silniki.mjs --post` z Fx3D) |
| 14 | Tarcze i trafienia w tarczę | 03 | 04–13, 15–20 | xhigh | zrobione, scalone (7703490) | 9b8dad0, 9b95df5, e566f74, 02d6f02 | graf na wariant + wartości per obiekt; trafienia w `uniformArray` pakowanej w `onObjectUpdate` |
| 15 | Mostki, rdzenie, reaktory, światła (+ `mostki-demo`, `rdzen-demo`) | 04 | 05–14, 16–20 | xhigh | w toku (podagent, worktree `statki-wt/15`; maska w `bridge3D` = zastępnik do 03) | | |
| 16 | Zniszczenie stacji (+ scena bazy `stacja-rozpad`) | 03 | 04–15, 17–19 | xhigh | czeka | | |
| 17 | Broń 1/2 z dema `bronie-webgpu`: efekty wszystkich broni (pociski, smugi, trafienia, wiązki, PD, flak) | 12, 04 | 05–11, 13–16, 19 | max | czeka | | nowe efekty — ocena obrazu zamiast tolerancji; PD i flak z kanwy 2D do 3D |
| 18 | Broń 2/2: obrażenia z dema — mapa ran, przebicia, rykoszety, ładowanie, serie; światła efektów na poszyciu | 17, 04 | 05–11, 13–16, 19 | max | część 18-A zrobiona i scalona (4e165fb): moduły mechaniki + zapytania `HullBodies` bez wpięcia; zostają 18-B (wpięcie, po 17), 18-C (mapa ran, po 04 i 12), 18-D | 8eaa828…2da882d | zatwierdzona zmiana rozgrywki |
| 19 | Rakiety z dema `rakiety-webgpu`: dym GPU, dysze, kule ognia, Supernowa, iskry | 12 | 05–11, 13–18 | max | czeka | | lot rakiet zostaje w `rocketSystem3D` |
| 20 | Koniec overlaya: wybuch reaktora w Core3D, usunięcie drugiego renderera | 17, 18, 19 | 13–16 | xhigh | czeka | | jeden renderer, jeden bloom |
| 21 | Asteroidy z dema `asteroidy-webgpu` + kolizje z olbrzymami | 12, 04, 05 (+ commit dema) | 13–20 | max | czeka (demo zacommitowane: 84198d3) | | zielone światło użytkownika; stare pole (zderzenia z małymi skałami, niszczenie, łup) znika — do decyzji użytkownika |
| 21b | Fizyka wydobycia asteroid w grze (drony, piła, ładunki, urobek) — logika i demo od sesji „Asteroid lighting bug demo” | 21, 12 (+ commit dema) | 22–23 | max | czeka (logika i demo zacommitowane: 84198d3) | | propozycja sesji fizyki skał; otwarte: kolizje odłamów, wpływ wybuchu, udźwig, ceny |
| 22 | Warp „Nurt” z dema `warp-webgpu` (iteracja 2) | 12, 13 (+ commit dema) | 14–21 | max | czeka (demo gotowe, commit przy starcie zadania) | | „ready do wgrania, jak skończy sesję”; wygląd iteracji 2 jeszcze nieoceniony |
| 23 | Wydajność i precyzja: A/B z tagiem, drżenie, kompilacja, pamięć | 04–22 | nie | max | czeka | | koszt portu osobno od kosztu nowych efektów |
| 24 | Sprzątanie i domknięcie portu | 23 | nie | xhigh | czeka | | decyzje PLAN §12 p. 1, 3 |

## Regresje przejściowe (świadome)

Stan zamierzony na `main` w trakcie portu — nie „naprawiać” poza zadaniem, które go kończy.

| Od | Do | Co | Kończy |
|---|---|---|---|
| 01 | 24 | Nieprzeniesione `ShaderMaterial` rysują się magentą (`spis.zamienniki` w harnessie) | zadania 02–22 |
| 01 | 03 | Maska słońca wyłączona (`uSunShadowOn = 0`): bez cienia słońca na materiałach, smug tła i SDF kadłubów; fala uderzeniowa bez passa refrakcji; kadłuby z 04 liczą pełne słońce (zastępnik `// AGENT: po 03` w `hexShips3D.tsl.js`) | 03 |
| 02 | 23 | Bloom = 12 osobnych `renderer.render()` (~0,9–1,0 ms CPU na render, GPU ~0,085 ms przy 1080p); znaczniki czasu ~15 µs CPU na pass | 23 |
| 01 | 11 | Rozgrzewka tylko „nie rzuca”: pipeline'y kompilują się asynchronicznie przy pierwszym użyciu, osłona `backend.draw` pomija rysunek do gotowości (obiekt pojawia się 1–2 klatki później) | 11 (moduły przez `Core3D.prewarmPass`) |
| 01 | 06 | Brak synchronicznego odczytu → mapa CPU ringu pusta (`heightAtUV` = 0): płyta ringu koliduje bez rzeźby terenu, LOD terenu bez wysokości, landmarki i kopuły stawiane bez mapy (stała wysokość z `haloRingLandmarks.js`) | 06 — ZAMKNIĘTE (070a407): teren w koliderze po `ring.ready`, sprawdzone w grze |
| 01 | 20 | Overlay efektów na własnym `WebGLRenderer` (jedyny drugi renderer; stare efekty overlaya działają bez zamienników) | 17–19 zabierają efekty, 20 usuwa overlay |
| 01 | 17–19 | Pociski i błyski ze starego `weapon3DSystem` (materiały wbudowane — rysują się), smugi `slugTrail3D` (zamiennik), dym i iskry Fx3D (zamiennik do 12) | 12, 17–19 |
| 01 | 22 | Soczewka i fale warpa usunięte (API jako no-op), skok działa bez efektu zgięcia | 22 (nowy warp) |
| Faza 0 | 21 | Stare pole asteroid i tło pasa wyłączone (`?asteroidyStare`) | 21 (nowe asteroidy) |

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
    przebiegami, bo inne sesje użytkownika pracowały na tym samym GPU/CPU; porównanie wydajności (zadanie 23) tylko
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
- Po kroku 6 użytkownik obejrzał dema broni i rakiet: „bronie — wszystkie super”, „rakiety — super”, wdrażać przy porcie
  (tabela decyzji). Przebudowa planu: stare 12 (port 1:1 broni), 17 (overlay na `CanvasTarget`) i 18 (wybuchy) usunięte;
  nowe 12 = infrastruktura efektów (compute w klatce, jedna siatka świateł z trzech kopii w demach, zniekształcenia,
  Fx3D 1:1), 17–18 = broń z `bronie-webgpu`, 19 = rakiety z `rakiety-webgpu` (iskry `SparkSystem3D` → `sparks.js`),
  20 = koniec overlaya (wybuch reaktora do Core3D, drugi renderer znika); dawne 19–20 → 21–22. Ustalenia: dema
  ustawiają `renderer.lighting = GridLighting` globalnie (w grze decyzja „kto czyta siatkę” w 12); gra woła efekty przez
  `WeaponShotBus.emit`, `spawnBulletImpactEffect` (bez trafionej encji i normalnej — 17 je dokłada), `superweapon.js`
  (Hexlance), `rocketSystem3D` (lot i trafienia zostają); laser PD i flak są dziś na kanwie 2D (18 przenosi do 3D);
  wieżyczki zostają 2D, mapa ran w uv nie wchodzi. Nowe efekty nie mają bazy w tagu — ocena użytkownika, potem przebieg
  z `main` jako baza. `INWENTARZ.md` z adnotacjami „zastąpi / port w …”, wygenerowany z czystego eksportu HEAD (bez
  niezacommitowanych zmian innych sesji).
- Krok 7: raport dla użytkownika w rozmowie; zadanie 01 czeka na zgodę.

### 2026-09-27 (wieczór) — egzekucja portu: orkiestrator + podagenci

- Użytkownik: praca samodzielna do końca, potem wyłączenie komputera (tabela decyzji). Organizacja: każde zadanie robi
  podagent w worktree `C:/Users/Szymon/Documents/GitHub/statki-wt/NN` (gałąź `webgpu/NN`); `node_modules` kopiowane
  robocopy (NIE dowiązanie — `git worktree remove --force` kasuje zawartość celu dowiązania, sprawdzone); worktree
  tworzyć z `git -c core.autocrlf=false` (inaczej CRLF i fałszywe porażki strażników); POSTEP / INWENTARZ prowadzi
  orkiestrator (`bash scripts/webgpu/inwentarz-czysty.sh` — inwentarz z czystego HEAD).
- Sesje dem: warp „Nurt” iteracja 2 gotowa (notatka w `DEMO-WARP.md` § Do portu w grze; sesja nie commituje bez zgody
  swojego użytkownika — pliki zacommituje orkiestrator przy starcie 22); asteroidy gotowe (`DEMO-ASTEROIDY.md` § Do portu
  w grze), ale sesja „Asteroid lighting bug demo” poprawia nocne światło dużych skał i robi fizykę / rozgrywkę skał
  (cięcie dronami, kopanie do rdzenia, ładunki, materiały) jako osobne API — **dema asteroid nie commitować przed jej
  sygnałem**, zadanie 21 = render + kolizje z olbrzymami, fizyka skał = osobne zadanie po jej meldunku.
- Projekt integracji broni (podagent-architekt) → `PROJEKT-BRONI.md`; decyzje §5 w imieniu użytkownika.
- **Zadanie 06 (ring 1/5) zrobione na gałęzi `webgpu/06`** (b7ecdc9, 0e53f47, 801317a, 446fbde, af86dd7, c1ad3d2) —
  czeka na scalenie 01 i weryfikację w grze:
  - biblioteka TSL ringu (`src/3d/haloRing/haloRingTSL.js`: całe `haloRingGLSL.js` + `SURFACE` / `CLOUDCOVER`),
    uniformy w jednym bloku (`createUniformBlock` — limit 12 buforów uniformów na etap; pieczenie miało 20 i pipeline
    się nie tworzył), pieczenie map i detal w TSL, odczyt CPU asynchroniczny (padding 256 B), budowa ringu
    asynchroniczna (`await ring.ready`; kolizje terenu po `ready`); `halo_ring_demo` na WebGPU (otoczenie w TSL);
  - mapa CPU vs WebGL z tagu: Mars i Jowisz bit w bit; Ziemia średnia różnica 0,0021 j., p99,9 0,075, maks. 0,569 j.,
    0 NaN; plan budowli (9 megabudowli, 12 kopuł) identyczny; naprawiony NaN z `pow(1-|n|, 3)` (ujemna podstawa);
  - czasy: kompilacja + mapa niska + odczyt 9,9 s (WebGL) → 1,4–2,5 s (WebGPU); demo do gotowości 31 s → 5,5 s;
  - pułapki: `setLayout` z uniformem w domknięciu (błąd r183 — PLAN §3), hasze float z niecałkowitych wejść różnią się
    między kompilatorami, v = 0 pieczenia u góry celu (bez odwracania osi), kolejność funkcji w WGSL zależy od kolejności
    budowy materiałów (jedna dodatkowa kompilacja na typ); `dema/kontenery.html` na `main` nie działa (dema poza portem —
    tag);
  - testy: 1337 / 7 porażek bazowych / 2 todo; nowe `haloRingTSL` (12, WGSL budowany w Node) i `haloRingAsync` (3);
    `menuBackdrop` (rozgrzewka) przepisany; inwentarz na gałęzi: port 42 pliki z GLSL, 68 materiałów, 8542 linie.
- **Część 18-A scalona do `main`** (8eaa828, 3c2ac69, 2da882d; scalenie 4e165fb): `HullBodies.surfaceNormal /
  traceThrough / spriteUvAt`, `hullImpactResult`, `hull.dmgKey` (dziedziczony przez wraki i odłamy), hak `onImpact`;
  `src/game/projectileMechanics.js` (`resolveHullHit`, `entryDamage`, `stepInsideHull`), `src/game/weaponCharge.js`
  (`stepCharge`, kolejka serii Hexlance'a); pola danych w `weapons.js` (penDepth / penSpeedLoss / ricochet / chargeTime
  Valkyrie / recoil i shake zgodne z `FX_PROFILE` — gra ich jeszcze nie czyta); `scripts/bilans-broni.mjs`, opis wpięcia
  `docs/webgpu/MECHANIKA-BRONI.md`. Fizyka kadłubów A/B z HEAD: identyczny hash stanu i sekwencja `Math.random` (240
  kroków). Testy na `main` po scaleniu: 1364 / 7 porażek bazowych / 2 todo, `npm test` OK.
  - Bilans (1000 strzałów, prawdziwe sprite'y): Mjolnir 312,5 → 227,3 dps (−27%), kolumna 3 okrętów ×5,0 straty na
    strzał; Valkyrie 166,7 → 152,5 dps (−8,5%), na wylot fregata 100% / niszczyciel 80% / pancernik 19%; Vulcan i
    Gatling S −1,5…−4,2% dps (rykoszety 2–6% trafień); Hexlance seria 4 cięć = +53…57% straty (nie ×4 — cięcia biegną
    tym samym pasem).
  - Decyzje podagenta (do przejrzenia): ponowne wejście w ten sam kadłub robi krater bez drugiego HP i bez liczenia do
    limitu przebić; krater zakleszczenia 0,5 × obrażeń × (v/v_wejścia)²; naładowane działo bez celu gaśnie po 2 s;
    kolejka serii z opóźnieniami względnymi; recoil/shake dopisane wszystkim broniom (warianty S/L, `ciws_mk2`,
    `hexlance_siege` dostały wartości rodziny z dema — dziś mają fallback 3/1,8, zmiana przy przełączeniu źródła w 18-D).
- **Zadanie 01 scalone do `main`** (fca136a, b9c95d2, be4ea80; scalenie 159dd42): Core3D na `WebGPURenderer`, tylko
  WebGPU (brak `navigator.gpu` / adaptera → komunikat w menu, przyciski startu wyłączone; `_getFallback = null`,
  `featureLevel: 'compatibility'`, limity z adaptera); `init()` synchroniczne, urządzenie w tle (`Core3D.gpuReady` /
  `Core3D.ready`); runner passów bez EffectComposer (tło → planety → quad halo → ring-planety → ortho → tarcze bez
  czyszczenia głębi → FG); post = `RenderPipeline` (ACES gry + sRGB gry, `outputColorTransform = false`), `renderBackdrop`
  tym samym postem; cienie per światło (`Core3D.setSunShadowLight`); `info.drawCalls`; zegar GPU = znaczniki czasu
  (1 zapytanie w locie; three nie czyści mapy `timestamps` — ~15,8 tys. wpisów — Core3D czyści sam); split tylko przez
  2× `renderSingle`; API warpa = no-opy + miejsce na pass zgięcia tła; `src/3d/tsl/` (`uniformy.js`, `zamiennik.js`,
  `kolorGry.js`); `Core3D.prewarmPass(obiekt, warstwa)` (rozgrzewka broni w `weapon3DSystem` wcześniej NIGDY się nie
  wykonywała — warunek `Core3D.camera` zawsze fałszywy); osłona `backend.draw` (three r183 wkłada pipeline z
  `compileAsync` do cache, zanim GPU go odda → `setPipeline(undefined)`, realny TypeError); `modelBaker.js` usunięty.
- Harness po 01: 16 scen / 32 warianty, renderer `webgpu`, 0 błędów WebGPU/WGSL, 0 ostrzeżeń three. Zamienniki: menu 80,
  hud 45, ring-z02 45, ring-z1 45, k7-hala 42, planeta-cien 10, slonce 8, mars-ring 69, jowisz-ring 75, kalibracja 14,
  bitwa 32, bitwa-blisko 24, wybuch 28, wraki 25, warp 51, split 15. `kalibracja__ortho` vs baza: >2 93,54%, >8 85,83%,
  >32 71,94%, średnia 75,96, maks 252 — sama poświata (brak bloomu), HDR > 0,9: 0,02515 vs 0,02525. Start: `gpuReady`
  ~4,3–4,5 s od nawigacji, tło menu ~5,6–5,9 s.
- **Nowa baza (tryb `--uuid osobne`):** three bierze 4 × `Math.random` na UUID każdego obiektu i węzła TSL, więc na
  WebGPU losowania gry przesuwały się (inne kąty planet, inne przebiegi wraków i warpa). Harness `--uuid osobne` daje UUID
  osobny strumień (podmiana w odpowiedzi serwera przez CDP — gra i tag bez zmian); bazę z tagu zrobiono ponownie w tym
  trybie (p1 = p2) — stan świata WebGPU zgodny w 16/16 scen. Przyjęta do `.tmp/webgpu/baseline/webgl/` (stara w
  `.tmp/webgpu/baseline-stara/`), `baseline.json` przebudowany (`losowanieUuid: 'osobne'`, `kodGry`). Harness wybiera tryb z
  bazy sam. Szum WebGPU p1/p2: 0 poza `planeta-cien` (0,06% — obrót stacji Wenus).
- Testy na `main` po scaleniu: `node --test` 1373 / 7 porażek bazowych + 1 niestabilny pod obciążeniem
  (`capitalAiFlight` „ship follows a moving target…”, sam przechodzi 3/3) / 2 todo; `npm test` OK. **Po każdym scaleniu:**
  `bash scripts/webgpu/lf-po-scaleniu.sh` — `git merge` przy `core.autocrlf=true` zapisuje zmienione pliki z CRLF i 4
  strażniki padają fałszywie (827, 828, 939, 941 po scaleniu 01).
- **Zadanie 06 scalone do `main`** (scalenie 070a407; na gałęzi po scaleniu 01: bc24e0b, f1aaa99, 88d8df5): ring w grze na
  WebGPU — 5 scen harnessu (ring-z02, ring-z1, k7-hala, mars-ring, jowisz-ring) bez błędów, `ringReady`, zrzuty piksel w
  piksel jak po 01 (materiały ringu to jeszcze zamienniki — 07–10). Kolider płyty dostaje teren dopiero po `ring.ready`
  (`scripts/webgpu/ring-kolizje-gra.mjs`): Ziemia 7060/7060 próbek ≠ 0 (−128…216), Mars 7036/7036 (1,5…171), Jowisz
  płaski pokład Fable (0…7) — wynik kolidera = `ring.terrainHeightAt`. Regresja „01 → 06” zamknięta. Czasy w grze:
  kompilacja pieczenia 2,5–3,7 s w tle, teren w koliderze 2,2–4,5 s od wstania gry (ring Ziemi piecze się już w menu).
  Adapter uniformów ringu = adapter z 01 (`src/3d/tsl/uniformy.js`, re-eksport w `haloUniformsAdapter.js`),
  `createUniformBlock` zostaje w `src/3d/haloRing/`. Otwarte dla 11: menu nie czeka na `ring.ready` (ring dołącza
  2–4,5 s po Ziemi), pusta scena `createHaloBakeWarmup` do usunięcia. Inwentarz po 06: port 42 pliki z GLSL, 66
  materiałów, 8504 linie. Testy na `main`: 1389 / 7 porażek bazowych / 2 todo + niestabilne pod obciążeniem całego
  zestawu (same przechodzą): `capitalAiFlight` („ship follows a moving target…”), `hullShadowSdf` („warstwy: wspólna dla
  świeżej floty…, LRU”).
- **Część 12-A scalona do `main`** (0f3d429, 4eb03d8, dba17aa, d086021, 37953a6): `src/3d/fx/` — `lightGrid.js` (jedna siatka
  świateł z trzech kopii dem; baza = wersja asteroid: wycinek koła reflektora, brzeg smoothstep², mapy cienia, profile
  `FIELD` / `CAVE`; układ lokalny przy kamerze liczony w double; 2 bufory storage; uniformy w grupie `render`; odrzucanie
  poza kadrem; naprawiony błąd wszystkich trzech kopii — przepełnienie granic komórek w `Int16Array` dla świateł daleko
  poza kadrem; właściciel 0 = brak; tryb `optIn`: siatkę czytają tylko materiały z flagą `gridLights` — reszta ma WGSL
  identyczny jak bez siatki), `fxLights.js` (błyski z nośnikiem, zero alokacji), `fxRandom.js` (mulberry32 dla efektów;
  harness ziarni go razem z `reseed` — 09f968c), `noise.js` (szumy bit w bit jak w demach), `carrier.js` (paczka nośnika +
  lustro CPU), `gpuPoolOrigin.js` (`FxPoolOrigin`: wspólny początek przy kamerze dla pul i siatki, przeskok co 20 tys. j.,
  kernel przesunięcia, epoki zegarów co 600 s — każda pula GPU MUSI się zarejestrować), `distortion.js`
  (`DistortionField`: fala, implozja, gorące powietrze z kierunkiem; jeden bufor, `DISTORT_CAP` 32). Opis:
  `docs/webgpu/FX-INFRA.md`. Koszt CPU siatki: 1024 światła 0,7 ms, 1536 — 1,1 ms. Ryzyko: `ITEM_CAP` nasyci się w dużej
  bitwie w polu asteroid (reflektory do 14 tys. j.) — ograniczyć reflektory do najbliższych / w kadrze (21). Testy na
  `main`: 1434 / 7 porażek bazowych / 2 todo.
- **Zadanie 07 scalone do `main`** (7b43733…96baa16; scalenie f735076): teren ringu (CDLOD z kaskadowym morphem w `Loop`,
  strefy, parki, zabudowa z odciskiem zestawu, konstrukcja, cienie chmur i terenu, burze, woda, światła miast, powietrze)
  i zestaw przemysłowy (`haloIndKitTSL`, liczby części z jednej definicji `kitParts` — bliźniak JS bit w bit; na GPU 0
  rozbieżnych decyzji w 20 480 częściach) w TSL; uniformy powierzchni w bloku `haloSurfU`; GLSL terenu usunięty,
  `HALO_GLSL_SURFACE` / `CLOUDCOVER` przeniesione do `haloRingGLSL.js` dla 08–09, `HALO_GLSL_INDKIT` zostaje dla miasta (09).
  Sam teren vs WebGL: demo p1–p9 ≤ 0,105% pikseli > 8/255 (tylko krawędzie MSAA), Ultra ≤ 0,048%; gra `k7-hala__teren`
  0,10% (harness `--teren-ringu`). Kompilacja terenu 0,4–1,3 s na zimno, 63–111 ms na ciepło (11: dodać teren do
  rozgrzewki — dziś pierwsza klatka przy ringu kompiluje go na zimno). Nowe pułapki (PLAN §3 / `agents.md`): stałe
  `smoothstep` z odwróconymi krawędziami są w WGSL błędem kompilacji (`haloSmooth`); `screenCoordinate` liczy y od góry
  (`haloFragCoordGL` dla ditheru 1:1); tekstura bez uv dostaje osobny uniform mat3 — uv-atrapa; FXC liczy `a·b + c` z
  jednym zaokrągleniem, DXC z dwoma — hasze z mnożenia i dodawania przez `haloFusedMulAddInt` (bit w bit z bazą);
  `haloStormFlash` (`cyc·1,37`) może mieć tę samą rozbieżność (burze tylko na Jowiszu z ringiem Fable — dziś niewidoczne).
  Inwentarz: port 41 plików z GLSL, 65 materiałów, 7979 linii. Testy na `main`: 1442 / 7 porażek bazowych / 2 todo.
- **Zadanie 04 scalone do `main`** (3adcc5c, 7599a42; scalenie f7c3c77 + 9841cbf — znaczniki konfliktu w `agents.md`
  trafiły do commitu scalenia, poprawione osobnym commitem): kadłuby belkowe i heksowe, lakier, odłamki GPU, smugi wraków i
  impostory ciał heksowych w TSL (`src/3d/hexShips3D.tsl.js`, −543 linie GLSL). Graf na wariant (skóra belek, siatka
  heksów, płyta pancerza, pula odłamków), każdy kadłub ma lekki `HullNodeMaterial` na wspólnych węzłach, wartości per
  kadłub przez `uniform().onObjectUpdate`; tekstury per obiekt przez `HullObjectTextureNode` (`texture().onObjectUpdate()`
  w r183 nie działa); lampy i strefy dysz w buforze storage `HullLightStore` (1024 sloty, zapis przy zmianie podpisu).
  Spawn 30 NPC: CPU pierwszej klatki 14,4 ms (WebGL 37 ms, graf na materiał 389 ms); bitwa 48 okrętów bez regresji, U hex
  niższe. Harness: 0 błędów, draw calle ortho = baza, `wraki__ortho` w tolerancji (0,44% >8/255… przed kalibracją 02 —
  sprawdzić ponownie), zamienniki bitwa 31 → 25, wybuch 28 → 22, wraki 22 → 18, warp 49 → 43. Znalezione: limit 8
  buforów wierzchołków (odłamki miały 9 — przeplecione), three połyka błąd `createRenderPipelineAsync` (Core3D loguje),
  pułapki w PLAN §3. Maska słońca: zastępnik pełnego słońca w jednym miejscu (`// AGENT: po 03`). `beamDebris3D.js`
  zostaje w GLSL (materiał tylko w demach destruktora). mostki-demo: kadłuby heksowe bez zamienników; odczyt HDR
  (`readRenderTargetPixels`) i przepełnienie puli znaczników w demie → 15 / 23.
- **Zadanie 02 scalone do `main`** (a72b8fa, 777f86b, 77eef2b; scalenie eb9370b): post w TSL (`src/3d/tsl/postGry.js`) —
  `BloomGry` na `BloomNode` (ten sam algorytm co `UnrealBloomPass`: próg, 5 mipów, jądra; kompozyt ×3 jak dawny pass —
  `BLOOM_ZGODNOSC_WEBGL`; alfa z rgb bloomu; bloom raz na render — split ma własny; skala rozdzielczości), pełny „uber”
  (24 źródła gorącego powietrza, dysze z kierunkiem, dyspersja, ACES gry + sRGB) 1:1 z GLSL (usunięty z `core3d.js`: 296
  → 148 linii GLSL, została maska słońca — 03); dwa `RenderPipeline` budowane raz (z bloomem i bez — wyłączony bloom nic
  nie kosztuje); MSAA 4 → 0 → 4 bez błędów; brama `_gpuTimerGate` (pula znaczników czasu three przepełniała się w
  headless). **Tolerancja portu skalibrowana:** `kalibracja__ortho` WebGL↔WebGPU >8/255 w 0,027% pikseli (średnia 0,0188;
  po 01 było 85,8%) — różnice tylko na krawędziach po resolve MSAA; `tolerancjaPortu` = >8/255 ≤ 0,05%, średnia ≤ 0,03
  (uwaga w `baseline.json`: sceny gęste w krawędzie mogą przekroczyć próg mimo zgodności — rozstrzyga mapa różnic).
  Gorące powietrze A/B: WebGL 0,0679% vs WebGPU 0,0676% pikseli zmienionych przez haze. Koszt: render Core3D z bloomem
  1,7–1,8 ms CPU / 0,19 ms GPU (bez 0,85 / 0,107) → regresja „02 → 23”. Narzędzia: `scripts/webgpu/post-kontrola.mjs`
  (16/16), `scripts/webgpu/gorace-powietrze.mjs`. Regresja „01 → 02” zamknięta. Testy na `main` po obu scaleniach: 1462 /
  7 porażek bazowych / 3 todo (nowe todo = parzystość proxy Z4 w `shipProxyBatch3D`, do Z13); `npm test` OK.
- **Zadanie 14 zrobione na gałęzi** (9b8dad0, 9b95df5): tarcze (sfera, obrys) i trafienia w tarczę (wstęgi, bańki) w TSL,
  graf na wariant + lekki materiał per tarcza; 24 trafienia w jednej `uniformArray` vec4 pakowanej per obiekt w
  `onObjectUpdate` (domyślnie pakuje się raz na `render()` — sprawdzone na GPU: bez tego wszystkie obiekty dostają dane
  pierwszego). Parzystość z GLSL tagu na GPU (cele RGBA32F): kopuły max |Δ| HDR 7e-5…2,9e-3, 0% pikseli >2/255 po ACES;
  wstęgi 0,01% (2 piksele wyładowań — hasz z niecałkowitych wejść). Spawn 30 NPC z tarczami: 0 nowych budów NodeBuildera
  tarcz, cache stały (51) przez 388 klatek. −583 linie GLSL. Uwaga dla 03: snapshot refrakcji rysuje warstwę tarcz do
  `refractionTarget` (inny kontekst renderu — osobna, nierozgrzana budowa tarcz przy pierwszej fali). Czeka na scalenie
  `main` i sprawdzenie z bloomem.
- **Zadanie 14 scalone do `main`** (9b8dad0, 9b95df5, scalenie `main` e566f74, 02d6f02; scalenie 7703490). Po 02 i 04
  (bloom, kadłuby w TSL) sama warstwa tarcz vs WebGL: 0% pikseli >8/255 (średnia 0,0154, z gorącym powietrzem z trafień —
  po 2 źródła `special` / `shield` na obu rendererach); kadłuby + tarcze 0,053% (jedyna różnica: kłąb dymu Fx3D —
  zamiennik do 12-B); `bitwa__ortho` 1,95% (po 01 było 14,5%; zostają dysze 13 i Fx3D 12-B), `wraki__ortho` 0,25%,
  `wraki__fg` 0%. Pełne sceny poza tolerancją przez tło (mgławica, gwiazdy, słońce — 05) i światła okrętów (15).
  Zamienniki: bitwa 26 → 20, bitwa-blisko 18 → 17, wybuch 22 → 16, wraki 19 → 15, warp 46 → 40; warstwa 7 bez
  zamienników. Narzędzie A/B tarcz w grze: `scripts/webgpu/tarcze-gra.mjs` (wymuszone trafienia 4 klas). Inwentarz z
  HEAD 7703490: port 36 plików z GLSL, 55 materiałów, 6743 linie. Testy: 1469 / 7 porażek bazowych / 3 todo; `npm test`
  OK. Wyniki: `.tmp/webgpu/zadania/14`, `14-po02`.
- **Zadanie 13 scalone do `main`** (e844a7a, c85042f, 3ff03a4; scalenia `main` 23ed7d5, 49e7fdf; scalenie bd96586): MAIN
  (`mainExhaust3D`), WARP (`warpPlume3D`: raymarch, poświaty, cząstki) i SIDE (`engineExhaustBatch`: płomień + 3
  poświaty) w TSL, −607 linii GLSL / −7 materiałów; `Engineeffects.js` bez martwego `getEngineVFX` (własny
  `WebGLRenderer`) — zostają tekstury. Plazma: jeden graf na rodzaj (`Loop(44)`, 3 oktawy jako stałe grafu), instancja
  puli = lekkie materiały na wspólnych węzłach (`onObjectUpdate`); cząstki = kwady na instancjach (punkty WebGPU mają
  1 px); pętla marszu za flagą (`discard` w WGSL nie kończy wykonania); mieszanie (ONE, ONE) przez
  `src/3d/tsl/mieszanie.js` (NodeMaterial z `premultipliedAlpha` mnoży wyjście przez alfę). Płomień SIDE miał 12 buforów
  wierzchołków (limit 8) — błąd pipeline'u i utracony bufor poleceń passa ortho, niewidoczny w harnessie (padł przed
  pierwszą sceną; harness zbiera błędy per scena — do poprawy w 23: błędy startu sesji). Weryfikacja
  (`scripts/webgpu/silniki.mjs`, same dysze vs tag): bufor HDR >8/255 ≤ 0,0014% (gracz 0%), energia RGB i piksele > 0,9
  równe; z postem 02 w tolerancji (warp 0,0007%, śr. 0,0055; bitwa 0,0004%; gracz 0%); gorące powietrze dysz A/B
  identyczne; SIDE w spoczynku 0 px > 0,9 (reguła jasności). Pierwszy skok i flota 16 instancji: 0 budów
  NodeBuilder/WGSL/pipeline'ów; najwolniejsze klatki to wgrywanie geometrii `hull:beam` 170 ms przy wejściu w skok (→ 23)
  i linie Fx3D 28 ms (12-B); tag WebGL: 132 ms (nowy program). Rozgrzewka SIDE (`EngineExhaustBatch`) niedopisana — 4
  pipeline'y w pierwszej klatce gry jak dawniej (→ 11). Zamienniki silników 0 (warp 49 → 13 po 02/04/13). Inwentarz z HEAD
  bd96586: port 32 pliki z GLSL, 48 materiałów, 6136 linii. Testy: 1477 / 7 porażek bazowych / 3 todo; `npm test` OK.
- **Zadanie 08 scalone do `main`** (2c87915, 9dbb513, 4d501b9, e00dd1b, 0ce79e1, fa8389b; scalenie `main` 60c7e4c;
  scalenie 979ed52): konstrukcja ringu (`HaloStructure` = NodeMaterial z `makeHaloStructureNodes`: płyty, miasto na
  ścianie, odcisk brył dachu z pozornymi cieniami, pasy świateł, światło analityczne, powietrze na ścianach; warianty
  górna ściana FG i reszta bryły; wspólny wierzchołek pasów `haloStripVertexTSL`; reguły dachu jako czyste funkcje,
  `haloRoofTSL(u)`) i atmosfera (`makeHaloCloudNodes`, `makeHaloShellNodes`) w TSL; usunięte GLSL obu modułów,
  `HALO_GLSL_CLOUDCOVER`, `haloPaletteDefines` (`HALO_GLSL_SURFACE`/`INDKIT` zostają dla 09, `HALO_GLSL_STORM` tylko
  dla narzędzia parzystości). Zgodność: demo `--set mid` (22 kadry) konstrukcja + chmury + powłoka ≤ 0,15% >8/255 (tylko
  krawędzie MSAA), Ultra ≤ 0,047%, noc ≤ 0,055%; gra: sceny ringu vs po 07/13 0%, `k7-hala` 0,0081%; nowe sceny (baza z
  tagu dopisana `baza.mjs --dopisz`): `ring-dach__ring-fg` 0,019%, `ring-dach-z01__ring-fg` 0,0015%,
  `ring-habitat__ring` 0,039%. Parzystość GPU: reguły dachu 0 rozbieżnych decyzji (4096 komórek / działek, 8192 klasy),
  hasze z wejść całkowitych 100%, hasz okien 99,4% (FMA tylko na składowej y — najbliżej bazy), kreski tarasów 99,2%.
  Kompilacja na zimno 1,1–1,7 s na wariant konstrukcji (WebGL 2,9 s; → rozgrzewka 11). Znalezione: `discard` w Tint nie
  przerywa shadera — znikająca górna ściana i puste chmury liczą pełne cieniowanie (→ 23: pomijać rysunek, osłonić
  chmury); teren w wariancie „do planety” z bliska 1,43% (`in_p1`, obszar 07). Narzędzia: `zrzuty.mjs --czesci-ringu`
  (warianty `__ring`, `__ring-tlo`, `__ring-fg`), sesja `ziemia-ring`, `halo-ring-shots.mjs --czesci`. Zamienniki:
  ring-z02 / ring-z1 44 → 40, k7-hala 41 → 37. Inwentarz z HEAD 979ed52: port 30 plików z GLSL, 45 materiałów, 5417 linii.
  Testy: 1486 / 7 porażek bazowych / 3 todo; `npm test` OK.
