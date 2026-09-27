# Port WebGPU — postęp

> Plik ciągłości między sesjami. Każda sesja zaczyna od niego i kończy na nim:
> co zrobione, commit, co dalej. Stan zadań portu — tabela „Zadania” (powstaje w Kroku 6
> Fazy 0). Dziennik sesji na końcu.

## Decyzje użytkownika (obowiązują cały port)

| Data | Decyzja |
|---|---|
| 2026-09-27 | **Jedna ścieżka renderu: WebGPU + TSL, GLSL usuwamy** (zmiana `PROMPT-START.md`, zasada 2). Bez dwóch równoległych ścieżek do końca portu. |
| 2026-09-27 | **Praca na `main`** (zasada 7); użytkownik ma lokalny backup (rar). |
| 2026-09-27 | **Warp poza portem** — stara soczewka do wyrzucenia, nowy warp (`dema/warp-demo.html`) wejdzie później od razu w TSL (`PROMPT-START.md` § Warp, `USTALENIA.md` §7). |
| 2026-09-27 | **Asteroidy poza portem** — nowe są gotowe w `dema/asteroidy.html` (i demo WebGPU `dema/asteroidy-webgpu.html`), więc starych nie przenosimy. |
| 2026-09-27 | Z listy zadań wypadły: Electron i build produkcyjny oraz przełączenie domyślnego backendu / polityka awaryjna (zmiana `PROMPT-START.md`). |

## Faza 0 — kroki

| Krok | Co | Status | Commit |
|---|---|---|---|
| 1 | Rozpoznanie (agents.md, USTALENIA, core3d.js, narzędzia CDP) | zrobione | — |
| 2 | Środowisko + testy bazowe | zrobione | (commit kroków 2–4) |
| 3 | Spike techniczny (`dema/webgpu-spike.*`, `SPIKE.md`) | zrobione — 17/17, bez blokad | (commit kroków 2–4) |
| 4 | Inwentarz (`scripts/webgpu/inwentarz.mjs` → `INWENTARZ.md`) | zrobione | (commit kroków 2–4) |
| 5 | Harness zrzutów + baza WebGL (`zrzuty.mjs`, `porownaj.mjs`, `baseline.json`) | — | |
| 6 | Plan i zadania (`PLAN.md`, `zadania/NN-*.md`, `README.md`, sekcja w `agents.md`) | — | |
| 7 | Raport dla użytkownika | — | |

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
