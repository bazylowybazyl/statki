# Inwentarz portu WebGPU

> Wygenerowane przez `node scripts/webgpu/inwentarz.mjs` — **nie edytować ręcznie**, uruchomić ponownie.
> Stan: 2026-09-28, HEAD `refs/heads/main`. Surowe dane: `.tmp/webgpu/inwentarz.json`.
> Zakres portu i decyzje: `docs/webgpu/PLAN.md`, `docs/webgpu/POSTEP.md`.

## Jak czytać

- **mat.** — miejsca tworzenia `ShaderMaterial` / `RawShaderMaterial` / `ShaderPass` (nie liczba instancji).
- **linie GLSL** — linie napisów rozpoznanych jako GLSL (≥ 2 znaczniki: `void main`, `gl_*`, `uniform`/`varying`, `vecN(`,
  `precision`, `#include`, `#define`…); szablon liczony w całości razem z `${…}`. Heurystyka — jak w `USTALENIA.md`.
- **oBC** — `onBeforeCompile` (w WebGPU nie istnieje). **cele renderu** — konstruktory celów. **odczyty** — `readRenderTargetPixels*` / `readPixels`.
- **inne WebGL / post** — `getContext`, `getExtension`, `capabilities`, `properties.get`, `gl.*`, `EffectComposer`, `RenderPass`, `ShaderPass`…
- **wbudowane mat.** — `MeshBasicMaterial`, `MeshStandardMaterial`, `ShadowMaterial`… WebGPURenderer zamienia je sam na wersje węzłowe
  (`StandardNodeLibrary`); do przeniesienia są tylko te z `onBeforeCompile` / `customProgramCacheKey`.
- **przebudowy** — `material.clone()` / `material.needsUpdate = true` / `defines`: w WebGPU każda nowa kombinacja = nowy pipeline.
- **status** — `GLSL` (do przeniesienia), `mieszany` (w trakcie), `TSL` (przeniesiony), `—` (bez shaderów).
- **zakres** — `port` = plik ładowany przez grę (graf importów od `index.html`) i nie wyłączony decyzją użytkownika;
  `warp` / `asteroidy-*` = poza portem (decyzje 2026-09-27); `poza grą` = tylko dema / narzędzia / nieużywany.

## Sumy

| zakres | pliki z GLSL | materiały | linie GLSL | oBC | odczyty | compile | wbudowane | clone / needsUpdate / defines | TSL / mieszane |
|---|---:|---|---:|---:|---:|---:|---:|---|---|
| **razem** | 24 | 46 (43 SM, 0 Raw, 3 ShaderPass) | 5236 | 0 | 2 | 5 | 31 | 4 / 16 / 6 | 75 / 0 |
| port | 6 | 7 (6 SM, 0 Raw, 1 ShaderPass) | 1165 | 0 | 1 | 5 | 20 | 4 / 7 / 0 | 71 / 0 |
| warp | 0 | 0 (0 SM, 0 Raw, 0 ShaderPass) | 0 | 0 | 0 | 0 | 0 | 0 / 0 / 0 | 0 / 0 |
| asteroidy-stare | 1 | 1 (1 SM, 0 Raw, 0 ShaderPass) | 66 | 0 | 0 | 0 | 2 | 0 / 3 / 0 | 0 / 0 |
| asteroidy-nowe | 7 | 15 (15 SM, 0 Raw, 0 ShaderPass) | 1889 | 0 | 1 | 0 | 0 | 0 / 0 / 1 | 0 / 0 |
| legacy | 1 | 5 (3 SM, 0 Raw, 2 ShaderPass) | 392 | 0 | 0 | 0 | 2 | 0 / 2 / 0 | 0 / 0 |
| poza grą | 9 | 18 (18 SM, 0 Raw, 0 ShaderPass) | 1724 | 0 | 0 | 0 | 7 | 0 / 4 / 5 | 4 / 0 |

### Porównanie z `USTALENIA.md` (~105 materiałów w 53 plikach, ~12,7 tys. linii GLSL w 59 plikach)

Tu: **46 miejsc tworzenia materiałów** (w tym 3 `ShaderPass`) w 22 plikach,
**5236 linii GLSL** w 24 plikach. Różnice: (1) ten lekser liczy szablony w całości
(z `${…}`) i także krótkie jednolinijkowe shadery w zwykłych napisach; (2) liczy `ShaderPass` jako materiał; (3) pliki dodane od
`2c2ef18` (ringi-archetypy Z6 `haloRing/arch/*`, budowle portowe Z7, burze pasa). Do planu liczy się wiersz **port**.

## Pliki w porcie (ładuje je gra)

| plik | mat. | linie GLSL | oBC | cele renderu | odczyty | compile | inne WebGL / post | wbudowane mat. | przebudowy (clone / needsUpdate / defines) | status | uwagi |
|---|---:|---:|---:|---|---:|---:|---|---:|---|---|---|
| `src/3d/haloRing/haloRingGLSL.js` |  | 604 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/effects3d/reactorblow.js` | 2 | 226 |  |  |  |  |  |  | · / · / · | GLSL | scena overlay; port do Core3D w zadaniu 20 |
| `src/3d/menuBackdrop3D.js` | 3 | 200 |  |  |  | 2 | initTexture |  | · / · / · | GLSL | rozgrzewka po kluczu programu WebGL — do przeprojektowania |
| `src/3d/beamDebris3D.js` | 1 | 64 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/effects3d/overlay.js` | 1 | 36 |  | WebGLRenderTarget |  |  | WebGLRenderer, EffectComposer, RenderPass, UnrealBloomPass, ShaderPass |  | · / · / · | GLSL | DRUGI WebGLRenderer (overlay3D eksplozji, własny composer i bloom; rakiety i iskry od zadania 19 w Core3D) — zostaje w porcie, usuwa go zadanie 20 |
| `src/3d/sunShadowMaskGLSL.js` |  | 35 |  |  |  |  |  |  | · / · / · | GLSL | LEGACY: GLSL maski dla nieprzeniesionych ShaderMaterial (planety 05, mostek 15, skały 21, Z4/Z5/Z7) — znika z ostatnim z nich (24) |
| `Engineeffects.js` |  |  |  |  |  |  |  |  | · / · / · | — | tylko tekstury poświaty dysz SIDE (make*Texture); martwe getEngineVFX z własnym WebGLRenderer i shader usunięte (zadanie 13) |
| `src/3d/coldWreckImpostors.js` |  |  |  |  |  |  |  |  | · / · / · | — | uśpione (wymaga hexGrid) |
| `src/3d/core3d.js` |  |  |  | RenderTarget×4 |  | 1 | initTexture | 2 | · / · / · | TSL | serce portu: WebGPURenderer, passy sceny (zadanie 01), post w TSL — bloom i uber z gorącym powietrzem w src/3d/tsl/postGry.js (zadanie 02); pass maski słońca w TSL (zadanie 03); fala z refrakcją i jej snapshot usunięte (zadanie 19 — zniekształcenia efektów); soczewka i fale warpa usunięte |
| `src/3d/fxParticles3D.js` |  |  |  |  |  |  |  | 2 | · / · / · | TSL | Fx3D: port 1:1 w zadaniu 12 (dysze MAIN, mostki, rdzenie) |
| `src/3d/haloRing/haloRingDetail.js` |  |  |  | RenderTarget |  | 1 |  |  | · / · / · | TSL |  |
| `src/3d/haloRing/haloRingWorldGen.js` |  |  |  | RenderTarget×2 | 1 | 1 |  |  | · / · / · | TSL | pieczenie map + odczyt CPU (WebGPU: asynchronicznie, bez odwracania osi — zadanie 06) |
| `src/3d/hexShips3D.js` |  |  |  |  |  |  |  |  | · / 1 / · | TSL | kadłuby = gałąź beam (BEAM_SKIN + HEX_FRAGMENT); gałąź heksów (HEX/ARMOR/DEBRIS, pula szczątków GPU) w grze rysuje tylko wyłączone asteroidy, ale stoją na niej mostki-demo, rdzen-demo i pomiar drżenia → port w zadaniu 04 |
| `src/3d/hullShadowSdf.js` |  |  |  |  |  |  |  |  | · / · / · | TSL | biblioteka SDF kadłubów; marsz w TSL (hullSdfShadow, zadanie 03); lustro CPU traceHullShadowCpu (test) |
| `src/3d/rockets/smoke.js` |  |  |  | RenderTarget |  |  |  |  | · / · / · | TSL |  |
| `src/3d/sparkSystem3D.js` |  |  |  |  |  |  |  |  | · / · / · | — | API iskier gry na puli z dema rakiet (src/3d/rockets/sparks.js) w scenie Core3D — zadanie 19 |
| `src/3d/sunShadowMask.js` |  |  |  |  |  |  |  |  | · / 1 / · | TSL | biblioteka maski słońca w TSL (screenUV) + hak wbudowanych materiałów (setupLightingModel / outputNode) — zadanie 03 |
| `src/effects3d/rocketSystem3D.js` |  |  |  |  |  |  |  |  | · / · / · | — | lot i trafienia rakiet (rozgrywka); wygląd — reżyser efektów z dema rakiet w Core3D (src/3d/rockets/, zadanie 19) |
| `src/vfx/destruction3D.js` |  |  |  |  |  |  |  |  | 2 / · / · | TSL | zniszczenie stacji |
| `src/vfx/shatterMaterial.js` |  |  |  |  |  |  |  |  | · / · / · | TSL | zniszczenie stacji |

## Poza portem — decyzje użytkownika

### Warp
(brak)

### Stare asteroidy
| plik | mat. | linie GLSL | oBC | cele renderu | odczyty | compile | inne WebGL / post | wbudowane mat. | przebudowy (clone / needsUpdate / defines) | status | uwagi |
|---|---:|---:|---:|---|---:|---:|---|---:|---|---|---|
| `src/3d/asteroidBeltBackdrop3D.js` | 1 | 66 |  |  |  |  |  | 1 | · / 2 / · | GLSL | tło pasa (ShaderMaterial + onBeforeCompile pyłu) |
| `src/3d/asteroidField3D.js` |  |  |  |  |  |  |  | 1 | · / 1 / · | — | sprite’y na MeshBasicMaterial + CAŁA rozgrywka asteroid; ciała heksowe rysuje hexShips3D |

Uwaga: **ścieżka heksów w `hexShips3D.js`** (HEX/ARMOR/DEBRIS, pula szczątków GPU, `createEntityMesh`/`updateEntityMesh`) rysuje w grze
tylko asteroidy (ciała heksowe, na czas portu wyłączone) — liczy się w wierszu `src/3d/hexShips3D.js` wyżej i przechodzi w zadaniu 04,
bo stoją na niej warsztaty `mostki-demo`, `rdzen-demo` i pomiar drżenia (PLAN.md §1 p. 7).
`coldWreckImpostors.js` / `coldWrecks.js` są uśpione (wymagają `hexGrid`).

### Nowe asteroidy (dema; wejdą z dema WebGPU)
| plik | mat. | linie GLSL | oBC | cele renderu | odczyty | compile | inne WebGL / post | wbudowane mat. | przebudowy (clone / needsUpdate / defines) | status | uwagi |
|---|---:|---:|---:|---|---:|---:|---|---:|---|---|---|
| `src/3d/rocks/rockMaterial3D.js` | 2 | 615 |  | WebGL3DRenderTarget |  |  | initRenderTarget |  | · / · / 1 | GLSL |  |
| `src/3d/rocks/rockMinerals3D.js` | 1 | 361 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/rocks/giantRock3D.js` | 2 | 282 |  | WebGL3DRenderTarget |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/beltDust3D.js` | 4 | 232 |  | WebGLRenderTarget |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/rocks/rockShapes3D.js` | 4 | 228 |  | WebGLArrayRenderTarget×2, WebGLRenderTarget | 1 |  | initRenderTarget |  | · / · / · | GLSL |  |
| `src/3d/fieldLights3D.js` | 1 | 145 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/beltStorm3D.js` | 1 | 26 |  |  |  |  |  |  | · / · / · | GLSL |  |

### Legacy
| plik | mat. | linie GLSL | oBC | cele renderu | odczyty | compile | inne WebGL / post | wbudowane mat. | przebudowy (clone / needsUpdate / defines) | status | uwagi |
|---|---:|---:|---:|---|---:|---:|---|---:|---|---|---|
| `planet3d.proc.js` | 5 | 392 |  |  |  |  | WebGLRenderer, EffectComposer, RenderPass, UnrealBloomPass, OutputPass, ShaderPass | 2 | · / 2 / · | GLSL |  |

## Poza grą (dema, narzędzia, nieużywane)

| plik | mat. | linie GLSL | oBC | cele renderu | odczyty | compile | inne WebGL / post | wbudowane mat. | przebudowy (clone / needsUpdate / defines) | status | uwagi |
|---|---:|---:|---:|---|---:|---:|---|---:|---|---|---|
| `src/3d/cargoContainers3D.js` | 2 | 405 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/effects3d/stationDestructionEffects.js` | 2 | 315 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/portBuildings/portBuildings3D.js` | 1 | 267 |  |  |  |  |  |  | · / · / 3 | GLSL |  |
| `src/3d/voxelShips3D.js` | 3 | 180 |  |  |  |  |  |  | · / 1 / · | GLSL |  |
| `src/3d/beamShips3D.js` | 4 | 148 |  |  |  |  |  | 2 | · / 2 / · | GLSL |  |
| `src/3d/portBuildings/portHullBuild3D.js` | 1 | 129 |  |  |  |  |  |  | · / · / 2 | GLSL |  |
| `src/3d/cargoDrones3D.js` | 2 | 126 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/portBuildings/portBuoys3D.js` | 2 | 84 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/shipProxyBatch3D.js` | 1 | 70 |  |  |  |  |  |  | · / · / · | GLSL |  |

## Biblioteki GLSL i ich użytkownicy

- `src/3d/cargoContainers3D.js` (405 linii GLSL)
  - `CARGO_LIGHT_GLSL` → `src/3d/cargoDrones3D.js`
  - `CARGO_NOISE_GLSL` → `src/3d/cargoDrones3D.js`
  - `CARGO_VIEW_GLSL` → `src/3d/cargoDrones3D.js`
- `src/3d/fieldLights3D.js` (145 linii GLSL)
  - `FIELD_LIGHTS_GLSL` → `src/3d/beltDust3D.js`, `src/3d/rocks/giantRock3D.js`, `src/3d/rocks/rockMaterial3D.js`, `src/3d/rocks/rockMinerals3D.js`
- `src/3d/haloRing/haloRingGLSL.js` (604 linii GLSL)
  - `HALO_GLSL_COMMON` → `src/3d/menuBackdrop3D.js`, `src/3d/portBuildings/portBuildings3D.js`, `src/3d/portBuildings/portHullBuild3D.js`
  - `HALO_GLSL_LIGHT` → `src/3d/menuBackdrop3D.js`, `src/3d/portBuildings/portBuildings3D.js`, `src/3d/portBuildings/portHullBuild3D.js`
  - `HALO_GLSL_NOISE` → `src/3d/portBuildings/portBuildings3D.js`, `src/3d/portBuildings/portHullBuild3D.js`
- `src/3d/rocks/rockShapes3D.js` (228 linii GLSL)
  - `ROCK_OCT_GLSL` → `src/3d/rocks/rockMaterial3D.js`

## Największe bloki GLSL

| plik:linia | nazwa | linie | zakres |
|---|---|---:|---|
| `src/3d/rocks/rockMaterial3D.js:328` | `ROCK_FRAGMENT` | 457 | asteroidy-nowe |
| `src/3d/rocks/rockMinerals3D.js:403` | `MINERAL_FRAGMENT` | 285 | asteroidy-nowe |
| `src/3d/cargoContainers3D.js:262` | `CONTAINER_FRAG` | 224 | poza grą (dema) |
| `src/3d/rocks/giantRock3D.js:134` | `GIANT_FRAGMENT` | 192 | asteroidy-nowe |
| `src/effects3d/stationDestructionEffects.js:54` | `vertexShader:` | 172 | poza grą (nieużywany) |
| `planet3d.proc.js:7` | `NOISE_FUNCTIONS` | 145 | legacy |
| `planet3d.proc.js:202` | `PLANET_FRAG` | 131 | legacy |
| `src/3d/haloRing/haloRingGLSL.js:552` | `HALO_GLSL_INDKIT` | 127 | port |
| `src/3d/rocks/rockShapes3D.js:308` | `—` | 124 | asteroidy-nowe |
| `src/3d/portBuildings/portBuildings3D.js:150` | `PB_GLSL_SURFACE` | 120 | poza grą (dema) |
| `src/3d/haloRing/haloRingGLSL.js:213` | `HALO_GLSL_LIGHT` | 109 | port |
| `src/3d/haloRing/haloRingGLSL.js:91` | `HALO_GLSL_NOISE` | 98 | port |
| `src/3d/portBuildings/portHullBuild3D.js:95` | `HULL_FRAGMENT` | 98 | poza grą (dema) |
| `src/effects3d/reactorblow.js:52` | `vertexShader:` | 94 | port |
| `src/3d/haloRing/haloRingGLSL.js:323` | `HALO_GLSL_AIR` | 88 | port |
| `src/3d/rocks/rockMaterial3D.js:243` | `ROCK_VERTEX` | 84 | asteroidy-nowe |
| `src/effects3d/stationDestructionEffects.js:226` | `fragmentShader:` | 83 | poza grą (nieużywany) |
| `src/3d/menuBackdrop3D.js:73` | `EARTH_FRAGMENT` | 82 | port |
| `src/3d/beltDust3D.js:200` | `SLICE_FRAGMENT` | 81 | asteroidy-nowe |
| `src/3d/rocks/rockMinerals3D.js:326` | `MINERAL_VERTEX` | 76 | asteroidy-nowe |
| `src/3d/fieldLights3D.js:62` | `FIELD_LIGHTS_GLSL` | 75 | asteroidy-nowe |
| `src/3d/rocks/rockMaterial3D.js:114` | `NOISE_FRAGMENT` | 71 | asteroidy-nowe |
| `src/3d/haloRing/haloRingGLSL.js:26` | `HALO_GLSL_COMMON` | 64 | port |
| `src/3d/menuBackdrop3D.js:207` | `SKY_FRAGMENT` | 63 | port |
| `src/3d/beamShips3D.js:25` | `SKIN_VERTEX_SHADER` | 61 | poza grą (dema) |
| `src/3d/rocks/giantRock3D.js:66` | `BAKE_FRAGMENT` | 56 | asteroidy-nowe |
| `src/3d/beamShips3D.js:87` | `SKIN_FRAGMENT_SHADER` | 55 | poza grą (dema) |
| `src/3d/cargoContainers3D.js:505` | `SHADOW_VERT` | 52 | poza grą (dema) |
| `src/effects3d/reactorblow.js:146` | `fragmentShader:` | 51 | port |
| `src/3d/haloRing/haloRingGLSL.js:425` | `HALO_GLSL_PORTSITES` | 50 | port |
| `planet3d.proc.js:152` | `PLANET_VERT` | 50 | legacy |
| `src/3d/beltDust3D.js:89` | `NOISE2D_FRAGMENT` | 48 | asteroidy-nowe |
| `src/3d/shipProxyBatch3D.js:86` | `FRAGMENT_SHADER` | 48 | poza grą (dema) |
| `src/3d/voxelShips3D.js:78` | `SKIN_VERTEX_SHADER` | 45 | poza grą (nieużywany) |
| `src/3d/asteroidBeltBackdrop3D.js:668` | `ROCK_FRAGMENT` | 42 | asteroidy-stare |
| `src/3d/voxelShips3D.js:159` | `DEBRIS_VERTEX_SHADER` | 42 | poza grą (nieużywany) |
| `src/3d/portBuildings/portBuildings3D.js:106` | `INSTANCE_VERTEX` | 41 | poza grą (dema) |
| `src/3d/fieldLights3D.js:214` | `BEAM_FRAGMENT` | 38 | asteroidy-nowe |
| `src/effects3d/reactorblow.js:256` | `vertexShader:` | 38 | port |
| `src/3d/beamDebris3D.js:54` | `VERTEX` | 37 | port |

## Przebudowy materiałów w locie (zakres: port)

`clone()` / `needsUpdate = true` (heurystyka: zmienna z „mat” w nazwie):

- needsUpdate — src/3d/bridgeFx3D.js:300
- needsUpdate — src/3d/hexShips3D.js:1406
- needsUpdate — src/3d/shipLights3D.js:202
- needsUpdate — src/3d/sunShadowMask.js:205
- clone — src/vfx/destruction3D.js:867
- clone — src/vfx/destruction3D.js:1162
- clone — src/vfx/panelShardManager.js:301
- clone — src/vfx/panelShardManager.js:310
- needsUpdate — src/vfx/panelShardManager.js:150
- needsUpdate — src/vfx/panelShardManager.js:177
- needsUpdate — src/vfx/panelShardManager.js:222

`defines` w plikach: (brak).

## Strony dem i narzędzi korzystające z shaderów gry

| strona | Core3D | własny WebGLRenderer | WebGPU | moduły gry z GLSL | używana przez |
|---|---|---|---|---|---|
| `dema/asteroidy.html` | tak |  |  | 9 (sunShadowMaskGLSL.js, beltStorm3D.js, fieldLights3D.js, beltDust3D.js, rockMinerals3D.js …(+4)) | `dema/asteroidy-webgpu.js`, `dema/asteroidy.js` |
| `dema/budowle-portowe.html` | tak |  |  | 7 (portBuoys3D.js, sunShadowMaskGLSL.js, portBuildings3D.js, portHullBuild3D.js, haloRingGLSL.js …(+2)) | `dema/budowle-portowe-shots.js`, `dema/budowle-portowe.js` |
| `dema/kontenery.html` |  | tak | tak | 3 (cargoDrones3D.js, sunShadowMaskGLSL.js, cargoContainers3D.js) | `dema/kontenery-shots.js`, `dema/kontenery.js` |
| `dema/mostki-demo.html` | tak |  |  | 2 (sunShadowMaskGLSL.js, beamDebris3D.js) | `dema/mostki-demo.js`, `dema/mostki-shots.js`, `dema/mostki3d-drzenie.js`, `dema/mostki3d-shots.js`, `dema/precyzja-drzenie.js` |
| `dema/rdzen-demo.html` | tak |  |  | 4 (sunShadowMaskGLSL.js, beamDebris3D.js, reactorblow.js, overlay.js) | `dema/rdzen-demo.js`, `dema/rdzen-gpu-check.js`, `dema/rdzen-shots.js` |
| `scripts/proxy-batch/index.html` | tak |  |  | 3 (sunShadowMaskGLSL.js, beamDebris3D.js, shipProxyBatch3D.js) | `scripts/proxy-batch/gallery.mjs`, `scripts/proxy-batch/lighting.mjs`, `scripts/proxy-batch/precision.mjs`, `scripts/proxy-batch/run.mjs`, `scripts/webgpu/inwentarz.mjs` |
| `scripts/webgpu/ring-tsl-parzystosc-strona.html` |  |  | tak | 1 (haloRingGLSL.js) | `scripts/webgpu/ring-tsl-parzystosc.mjs` |
| `scripts/webgpu/tarcze-parzystosc-strona.html` | tak | tak | tak | 1 (sunShadowMaskGLSL.js) | `scripts/webgpu/tarcze-parzystosc.mjs` |
| `destruktor2d.html` |  | tak |  | 2 (beamShips3D.js, beamDebris3D.js) |  |
| `destruktor3d.html` |  | tak |  | 2 (beamShips3D.js, beamDebris3D.js) |  |

## Testy czytające shadery / strukturę Core3D (kandydaci do przepisania)

| test | moduły z GLSL / core3d |
|---|---|
| `tests/beamShips3D.test.mjs` | `src/3d/beamShips3D.js` |
| `tests/beamSkinSurface3D.test.mjs` | `src/3d/beamShips3D.js` |
| `tests/cargoContainers3D.test.mjs` | `src/3d/cargoContainers3D.js`, `src/3d/cargoDrones3D.js` |
| `tests/fx3dTSL.test.mjs` | `src/3d/core3d.js` |
| `tests/fxCore3D.test.mjs` | `src/3d/core3d.js` |
| `tests/haloRingK7ArchTSL.test.mjs` | `src/3d/haloRing/haloRingGLSL.js` |
| `tests/haloRingMegaCityTSL.test.mjs` | `src/3d/haloRing/haloRingGLSL.js` |
| `tests/haloRingStructureTSL.test.mjs` | `src/3d/haloRing/haloRingGLSL.js` |
| `tests/haloRingTerrainTSL.test.mjs` | `src/3d/haloRing/haloRingGLSL.js` |
| `tests/hexShips3DShader.test.mjs` | `src/3d/core3d.js` |
| `tests/hullDamageMap.test.mjs` | `src/3d/core3d.js` |
| `tests/menuBackdrop.test.mjs` | `src/3d/menuBackdrop3D.js`, `src/3d/core3d.js` |
| `tests/mostkiRdzenieTSL.test.mjs` | `src/3d/core3d.js` |
| `tests/overlayContextMerge.test.mjs` | `src/effects3d/overlay.js` |
| `tests/perfInstrumentation.test.mjs` | `src/3d/core3d.js` |
| `tests/portBuildings.test.mjs` | `src/3d/portBuildings/portBuildings3D.js`, `src/3d/portBuildings/portBuoys3D.js`, `src/3d/portBuildings/portHullBuild3D.js`, `src/3d/core3d.js` |
| `tests/renderPerfGates.test.mjs` | `src/effects3d/overlay.js`, `src/effects3d/reactorblow.js`, `src/3d/core3d.js` |
| `tests/ringPlanetAnchoring.test.mjs` | `src/3d/core3d.js` |
| `tests/rocketFx.test.mjs` | `src/3d/core3d.js` |
| `tests/sceneMatrixSync.test.mjs` | `src/3d/core3d.js` |
| `tests/shaderPrewarm.test.mjs` | `src/effects3d/overlay.js` |
| `tests/shadowShaftsQuality.test.mjs` | `src/3d/asteroidBeltBackdrop3D.js`, `src/3d/haloRing/haloRingGLSL.js`, `src/3d/sunShadowMaskGLSL.js`, `src/3d/core3d.js` |
| `tests/shipLights3D.test.mjs` | `src/3d/core3d.js` |
| `tests/shipProxyBatch3D.test.mjs` | `src/3d/shipProxyBatch3D.js`, `src/3d/core3d.js` |
| `tests/sunShadowMaskTSL.test.mjs` | `src/3d/core3d.js` |
| `tests/warpNurt.test.mjs` | `src/3d/core3d.js` |
| `tests/webgpuFundament.test.mjs` | `src/effects3d/overlay.js`, `src/3d/core3d.js` |
| `tests/webgpuPost.test.mjs` | `src/3d/core3d.js` |
| `tests/zniszczenieStacjiTSL.test.mjs` | `src/3d/core3d.js` |
