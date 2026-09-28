# Inwentarz portu WebGPU

> Wygenerowane przez `node scripts/webgpu/inwentarz.mjs` — **nie edytować ręcznie**, uruchomić ponownie.
> Stan: 2026-09-28, HEAD `refs/heads/main`. Surowe dane: `.tmp/webgpu/inwentarz.json`.
> Zakres portu i decyzje: `docs/webgpu/PLAN.md`, `docs/webgpu/POSTEP.md`.

## Jak czytać

- **mat.** — miejsca tworzenia `ShaderMaterial` / `RawShaderMaterial` / `ShaderPass` (nie liczba instancji).
- **linie GLSL** — linie napisów rozpoznanych jako GLSL (≥ 2 znaczniki: `void main`, `gl_*`, `uniform`/`varying`, `vecN(`,
  `precision`, `#include`, `#define`…); szablon liczony w całości razem z `${…}`. Heurystyka — jak w `USTALENIA.md`.
- **oBC** — `onBeforeCompile` (w WebGPU nie istnieje). **cele renderu** — konstruktory celów. **odczyty** — `readRenderTargetPixels*` / `readPixels`.
- **inne WebGL / post** — wzorce `WEBGL_API` strażnika (`scripts/webgpu/grafGry.mjs`): `WebGLRenderer`, cele `WebGL*RenderTarget`,
  `EffectComposer` / `RenderPass` / `ShaderPass` / `UnrealBloomPass`, `getContext('webgl')`, `getExtension`, metody kontekstu
  `gl.*`, `renderer.state|properties|capabilities|extensions`, importy postprocessingu z przykładów three. Metody wspólne
  z WebGPURenderer (`initTexture`, `initRenderTarget`, `compileAsync`) się nie liczą.
- **wbudowane mat.** — `MeshBasicMaterial`, `MeshStandardMaterial`, `ShadowMaterial`… WebGPURenderer zamienia je sam na wersje węzłowe
  (`StandardNodeLibrary`); do przeniesienia są tylko te z `onBeforeCompile` / `customProgramCacheKey`.
- **przebudowy** — `material.clone()` / `material.needsUpdate = true` / `defines`: w WebGPU każda nowa kombinacja = nowy pipeline.
- **status** — `GLSL` (do przeniesienia), `mieszany` (w trakcie), `TSL` (przeniesiony), `—` (bez shaderów).
- **zakres** — `port` = plik ładowany przez grę (graf importów od `index.html`); `poza portem` = ładowany przez grę,
  ale wyłączony decyzją użytkownika (`POZA_PORTEM` w `scripts/webgpu/grafGry.mjs` — ta sama lista co w strażniku
  `tests/graBezGlsl.test.mjs`); `poza grą` = tylko dema / narzędzia / nieużywany.
- **Port zakończony (zadanie 24):** grupa `port` ma 0 linii GLSL, 0 `ShaderMaterial` / `onBeforeCompile` i 0 API WebGL —
  pilnuje tego strażnik; GLSL został tylko w modułach poza grą (przejdą na TSL przy integracji).

## Sumy

| zakres | pliki z GLSL | materiały | linie GLSL | oBC | odczyty | compile | wbudowane | clone / needsUpdate / defines | TSL / mieszane |
|---|---:|---|---:|---:|---:|---:|---:|---|---|
| **razem** | 10 | 14 (14 SM, 0 Raw, 0 ShaderPass) | 1932 | 0 | 2 | 2 | 26 | 3 / 10 / 5 | 102 / 0 |
| port | 0 | 0 (0 SM, 0 Raw, 0 ShaderPass) | 0 | 0 | 2 | 2 | 19 | 3 / 7 / 0 | 98 / 0 |
| poza portem | 1 | 0 (0 SM, 0 Raw, 0 ShaderPass) | 35 | 0 | 0 | 0 | 0 | 0 / 0 / 0 | 0 / 0 |
| poza grą | 9 | 14 (14 SM, 0 Raw, 0 ShaderPass) | 1897 | 0 | 0 | 0 | 7 | 0 / 3 / 5 | 4 / 0 |

### Porównanie z `USTALENIA.md` (~105 materiałów w 53 plikach, ~12,7 tys. linii GLSL w 59 plikach)

Tu: **14 miejsc tworzenia materiałów** (w tym 0 `ShaderPass`) w 8 plikach,
**1932 linii GLSL** w 10 plikach. Różnice: (1) ten lekser liczy szablony w całości
(z `${…}`) i także krótkie jednolinijkowe shadery w zwykłych napisach; (2) liczy `ShaderPass` jako materiał; (3) pliki dodane od
`2c2ef18` (ringi-archetypy Z6 `haloRing/arch/*`, budowle portowe Z7, burze pasa). Do planu liczy się wiersz **port**.

## Pliki w porcie (ładuje je gra)

| plik | mat. | linie GLSL | oBC | cele renderu | odczyty | compile | inne WebGL / post | wbudowane mat. | przebudowy (clone / needsUpdate / defines) | status | uwagi |
|---|---:|---:|---:|---|---:|---:|---|---:|---|---|---|
| `Engineeffects.js` |  |  |  |  |  |  |  |  | · / · / · | — | tylko tekstury poświaty dysz SIDE (make*Texture); getEngineVFX z własnym WebGLRenderer usunięte (zadanie 13) |
| `src/3d/asteroids/asteroidBelt.js` |  |  |  |  |  |  |  |  | · / · / · | TSL | pas asteroid z dema WebGPU (zadanie 21): klej klatki jako krok Core3D.fx, warstwy passów gry i tła |
| `src/3d/asteroids/beltMedium.js` |  |  |  |  |  |  |  |  | · / · / · | TSL | ośrodek objętościowy pasa (zadanie 21) — czytają go skały, minerały, olbrzymy i kadłuby (hak hullVolume) |
| `src/3d/asteroids/rockBank.js` |  |  |  | RenderTarget×2 | 1 |  |  |  | · / · / · | TSL |  |
| `src/3d/asteroids/spotShadows.js` |  |  |  | RenderTarget |  |  |  |  | · / · / · | TSL |  |
| `src/3d/coldWreckImpostors.js` |  |  |  |  |  |  |  |  | · / · / · | — | uśpione (wymaga hexGrid) |
| `src/3d/core3d.js` |  |  |  | RenderTarget×4 |  |  |  | 2 | · / · / · | TSL | serce renderu: WebGPURenderer, passy scen do composerTarget, post w TSL (src/3d/tsl/postGry.js, bloom compute), maska słońca w TSL, klatka efektów GPU (Core3D.fx), rejestr rozgrzewki (Core3D.warmup) |
| `src/3d/fxParticles3D.js` |  |  |  |  |  |  |  | 2 | · / · / · | TSL | Fx3D w TSL (zadanie 12): dysze MAIN, mostki, rdzenie |
| `src/3d/haloRing/haloRingDetail.js` |  |  |  | RenderTarget |  |  |  |  | · / · / · | TSL |  |
| `src/3d/haloRing/haloRingWorldGen.js` |  |  |  | RenderTarget×2 | 1 |  |  |  | · / · / · | TSL | pieczenie map + odczyt CPU (WebGPU: asynchronicznie, bez odwracania osi — zadanie 06) |
| `src/3d/hexShips3D.js` |  |  |  |  |  |  |  |  | · / 1 / · | TSL | kadłuby: skóra belek w partiach (hullSkinBatch.js), grafy TSL w hexShips3D.tsl.js; gałąź heksów (HEX/ARMOR/DEBRIS) rysuje w grze tylko to, co ma hexGrid — stoją na niej warsztaty mostki-demo, rdzen-demo i pomiar drżenia |
| `src/3d/hullShadowSdf.js` |  |  |  |  |  |  |  |  | · / · / · | TSL | biblioteka SDF kadłubów; marsz w TSL (hullSdfShadow, zadanie 03); lustro CPU traceHullShadowCpu (test) |
| `src/3d/menuBackdrop3D.js` |  |  |  |  |  |  |  |  | · / · / · | TSL | tło menu w TSL (menuBackdrop3D.tsl.js), rozgrzewka przez rejestr Core3D.warmup (zadanie 11) |
| `src/3d/rockets/smoke.js` |  |  |  | RenderTarget |  |  |  |  | · / · / · | TSL |  |
| `src/3d/rozgrzewka.js` |  |  |  |  |  | 2 |  |  | · / · / · | — |  |
| `src/3d/sparkSystem3D.js` |  |  |  |  |  |  |  |  | · / · / · | — | API iskier gry na puli z dema rakiet (src/3d/rockets/sparks.js) w scenie Core3D — zadanie 19 |
| `src/3d/sunShadowMask.js` |  |  |  |  |  |  |  |  | · / 1 / · | TSL | biblioteka maski słońca w TSL (screenUV) + hak wbudowanych materiałów (setupLightingModel / outputNode) — zadanie 03; re-eksport SUN_SHADOW_GLSL tylko dla budowli Z7 (POZA_PORTEM) |
| `src/effects3d/reactorblow.js` |  |  |  |  |  |  |  |  | · / · / · | TSL | wybuch reaktora w scenie Core3D (zadanie 20): pule particlePool.js, materiały TSL w reactorblow.tsl.js, wygląd dawnego overlaya pod post gry (reactorLook) |
| `src/effects3d/rocketSystem3D.js` |  |  |  |  |  |  |  |  | · / · / · | — | lot i trafienia rakiet (rozgrywka); wygląd — reżyser efektów z dema rakiet w Core3D (src/3d/rockets/, zadanie 19) |
| `src/vfx/destruction3D.js` |  |  |  |  |  |  |  |  | 1 / · / · | TSL | zniszczenie stacji |
| `src/vfx/shatterMaterial.js` |  |  |  |  |  |  |  |  | · / · / · | TSL | zniszczenie stacji |

## Poza portem — decyzje użytkownika

Moduły ładowane przez grę, ale poza portem (PLAN §12 p. 1; lista `POZA_PORTEM` w `scripts/webgpu/grafGry.mjs`):

| plik | mat. | linie GLSL | oBC | cele renderu | odczyty | compile | inne WebGL / post | wbudowane mat. | przebudowy (clone / needsUpdate / defines) | status | uwagi |
|---|---:|---:|---:|---|---:|---:|---|---:|---|---|---|
| `src/3d/sunShadowMaskGLSL.js` |  | 35 |  |  |  |  |  |  | · / · / · | GLSL | napis GLSL maski dla modułów Z4/Z5/Z7 poza grą — znika z ostatnim z nich (przejście na TSL przy integracji) |

Moduły rozwijane poza grą — Z4 `shipProxyBatch3D`, Z5 `cargoContainers3D` / `cargoDrones3D`, Z7 `portBuildings/*`,
`beamShips3D` / `beamDebris3D` dem destruktora — zostają w GLSL (na WebGPU zamienniki) i przejdą na TSL przy swojej
integracji (tabela „Poza grą” niżej). Asteroidy: stare pole, tło pasa i klej WebGL usunięte w zadaniu 21 — pas z dema
WebGPU (`src/3d/asteroids/`) jest w porcie. Uwaga: **ścieżka heksów w `hexShips3D.js`** (HEX/ARMOR/DEBRIS, pula
szczątków GPU) nie ma w grze ciał (stare asteroidy usunięte); stoją na niej warsztaty `mostki-demo`, `rdzen-demo` i pomiar
drżenia (PLAN.md §1 p. 7). `coldWreckImpostors.js` / `coldWrecks.js` są uśpione (wymagają `hexGrid`).

## Poza grą (dema, narzędzia, nieużywane)

| plik | mat. | linie GLSL | oBC | cele renderu | odczyty | compile | inne WebGL / post | wbudowane mat. | przebudowy (clone / needsUpdate / defines) | status | uwagi |
|---|---:|---:|---:|---|---:|---:|---|---:|---|---|---|
| `src/3d/haloRing/haloRingGLSL.js` |  | 604 |  |  |  |  |  |  | · / · / · | GLSL | GLSL ringu poza grą: budowle Z7 (COMMON, NOISE, LIGHT) i narzędzie parzystości GLSL ↔ TSL (scripts/webgpu/ring-tsl-parzystosc.mjs); gra czyta haloRingTSL.js |
| `src/3d/cargoContainers3D.js` | 2 | 405 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/portBuildings/portBuildings3D.js` | 1 | 267 |  |  |  |  |  |  | · / · / 3 | GLSL |  |
| `src/3d/beamShips3D.js` | 4 | 148 |  |  |  |  |  | 2 | · / 2 / · | GLSL |  |
| `src/3d/portBuildings/portHullBuild3D.js` | 1 | 129 |  |  |  |  |  |  | · / · / 2 | GLSL |  |
| `src/3d/cargoDrones3D.js` | 2 | 126 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/portBuildings/portBuoys3D.js` | 2 | 84 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/shipProxyBatch3D.js` | 1 | 70 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/beamDebris3D.js` | 1 | 64 |  |  |  |  |  |  | · / · / · | GLSL | pula odłamków dem destruktora (własny WebGLRenderer) — geometria dla gry w metalDebrisGeometry.js |

## Biblioteki GLSL i ich użytkownicy

- `src/3d/cargoContainers3D.js` (405 linii GLSL)
  - `CARGO_LIGHT_GLSL` → `src/3d/cargoDrones3D.js`
  - `CARGO_NOISE_GLSL` → `src/3d/cargoDrones3D.js`
  - `CARGO_VIEW_GLSL` → `src/3d/cargoDrones3D.js`
- `src/3d/haloRing/haloRingGLSL.js` (604 linii GLSL)
  - `HALO_GLSL_COMMON` → `src/3d/portBuildings/portBuildings3D.js`, `src/3d/portBuildings/portHullBuild3D.js`
  - `HALO_GLSL_LIGHT` → `src/3d/portBuildings/portBuildings3D.js`, `src/3d/portBuildings/portHullBuild3D.js`
  - `HALO_GLSL_NOISE` → `src/3d/portBuildings/portBuildings3D.js`, `src/3d/portBuildings/portHullBuild3D.js`
- `src/3d/sunShadowMaskGLSL.js` (35 linii GLSL)
  - `SUN_SHADOW_GLSL` → `src/3d/cargoContainers3D.js`, `src/3d/cargoDrones3D.js`, `src/3d/shipProxyBatch3D.js`

## Największe bloki GLSL

| plik:linia | nazwa | linie | zakres |
|---|---|---:|---|
| `src/3d/cargoContainers3D.js:265` | `CONTAINER_FRAG` | 224 | poza grą (dema) |
| `src/3d/haloRing/haloRingGLSL.js:554` | `HALO_GLSL_INDKIT` | 127 | poza grą (dema) |
| `src/3d/portBuildings/portBuildings3D.js:150` | `PB_GLSL_SURFACE` | 120 | poza grą (dema) |
| `src/3d/haloRing/haloRingGLSL.js:215` | `HALO_GLSL_LIGHT` | 109 | poza grą (dema) |
| `src/3d/haloRing/haloRingGLSL.js:93` | `HALO_GLSL_NOISE` | 98 | poza grą (dema) |
| `src/3d/portBuildings/portHullBuild3D.js:95` | `HULL_FRAGMENT` | 98 | poza grą (dema) |
| `src/3d/haloRing/haloRingGLSL.js:325` | `HALO_GLSL_AIR` | 88 | poza grą (dema) |
| `src/3d/haloRing/haloRingGLSL.js:28` | `HALO_GLSL_COMMON` | 64 | poza grą (dema) |
| `src/3d/beamShips3D.js:29` | `SKIN_VERTEX_SHADER` | 61 | poza grą (dema) |
| `src/3d/beamShips3D.js:91` | `SKIN_FRAGMENT_SHADER` | 55 | poza grą (dema) |
| `src/3d/cargoContainers3D.js:508` | `SHADOW_VERT` | 52 | poza grą (dema) |
| `src/3d/haloRing/haloRingGLSL.js:427` | `HALO_GLSL_PORTSITES` | 50 | poza grą (dema) |
| `src/3d/shipProxyBatch3D.js:89` | `FRAGMENT_SHADER` | 48 | poza grą (dema) |
| `src/3d/portBuildings/portBuildings3D.js:106` | `INSTANCE_VERTEX` | 41 | poza grą (dema) |
| `src/3d/beamDebris3D.js:14` | `VERTEX` | 37 | poza grą (dema) |
| `src/3d/cargoDrones3D.js:170` | `DRONE_VERT` | 37 | poza grą (dema) |
| `src/3d/cargoDrones3D.js:208` | `DRONE_FRAG` | 37 | poza grą (dema) |
| `src/3d/cargoContainers3D.js:229` | `CONTAINER_VERT` | 35 | poza grą (dema) |
| `src/3d/sunShadowMaskGLSL.js:24` | `SUN_SHADOW_GLSL` | 35 | poza portem |
| `src/3d/haloRing/haloRingGLSL.js:497` | `HALO_GLSL_FG` | 34 | poza grą (dema) |
| `src/3d/portBuildings/portBuoys3D.js:59` | `LIGHT_VERTEX` | 33 | poza grą (dema) |
| `src/3d/cargoContainers3D.js:561` | `SHADOW_FRAG` | 32 | poza grą (dema) |
| `src/3d/cargoContainers3D.js:178` | `CARGO_LIGHT_GLSL` | 31 | poza grą (dema) |
| `src/3d/portBuildings/portHullBuild3D.js:63` | `HULL_VERTEX` | 31 | poza grą (dema) |
| `src/3d/cargoDrones3D.js:248` | `LIGHT_VERT` | 28 | poza grą (dema) |
| `src/3d/beamDebris3D.js:52` | `FRAGMENT` | 27 | poza grą (dema) |
| `src/3d/cargoDrones3D.js:277` | `LIGHT_FRAG` | 24 | poza grą (dema) |
| `src/3d/portBuildings/portBuildings3D.js:52` | `PB_GLSL_UNIFORMS` | 24 | poza grą (dema) |
| `src/3d/portBuildings/portBuildings3D.js:346` | `LABEL_FRAGMENT` | 23 | poza grą (dema) |
| `src/3d/shipProxyBatch3D.js:64` | `VERTEX_SHADER` | 22 | poza grą (dema) |
| `src/3d/portBuildings/portBuildings3D.js:325` | `LABEL_VERTEX` | 21 | poza grą (dema) |
| `src/3d/cargoContainers3D.js:210` | `CARGO_NOISE_GLSL` | 18 | poza grą (dema) |
| `src/3d/haloRing/haloRingGLSL.js:196` | `HALO_GLSL_STORM` | 18 | poza grą (dema) |
| `src/3d/portBuildings/portBuoys3D.js:22` | `BODY_VERTEX` | 18 | poza grą (dema) |
| `src/3d/portBuildings/portBuoys3D.js:40` | `BODY_FRAGMENT` | 18 | poza grą (dema) |
| `src/3d/portBuildings/portBuildings3D.js:296` | `PLATE_VERTEX` | 17 | poza grą (dema) |
| `src/3d/haloRing/haloRingGLSL.js:534` | `HALO_GLSL_RTE` | 16 | poza grą (dema) |
| `src/3d/portBuildings/portBuoys3D.js:92` | `LIGHT_FRAGMENT` | 15 | poza grą (dema) |
| `src/3d/cargoContainers3D.js:161` | `CARGO_VIEW_GLSL` | 13 | poza grą (dema) |
| `src/3d/beamShips3D.js:158` | `NODE_FRAGMENT_SHADER` | 12 | poza grą (dema) |

## Przebudowy materiałów w locie (zakres: port)

`clone()` / `needsUpdate = true` (heurystyka: zmienna z „mat” w nazwie):

- needsUpdate — src/3d/bridgeFx3D.js:302
- needsUpdate — src/3d/hexShips3D.js:1471
- needsUpdate — src/3d/shipLights3D.js:202
- needsUpdate — src/3d/sunShadowMask.js:209
- clone — src/vfx/destruction3D.js:1177
- clone — src/vfx/panelShardManager.js:301
- clone — src/vfx/panelShardManager.js:310
- needsUpdate — src/vfx/panelShardManager.js:150
- needsUpdate — src/vfx/panelShardManager.js:177
- needsUpdate — src/vfx/panelShardManager.js:222

`defines` w plikach: (brak).

## Strony dem i narzędzi korzystające z shaderów gry

| strona | Core3D | własny WebGLRenderer | WebGPU | moduły gry z GLSL | używana przez |
|---|---|---|---|---|---|
| `dema/asteroidy.html` | tak |  |  | 1 (sunShadowMaskGLSL.js) | `dema/asteroidy-webgpu.js`, `dema/asteroidy.js` |
| `dema/budowle-portowe.html` | tak |  |  | 6 (portBuoys3D.js, sunShadowMaskGLSL.js, portBuildings3D.js, portHullBuild3D.js, haloRingGLSL.js …(+1)) | `dema/budowle-portowe-shots.js`, `dema/budowle-portowe.js` |
| `dema/kontenery.html` |  | tak | tak | 3 (cargoDrones3D.js, sunShadowMaskGLSL.js, cargoContainers3D.js) | `dema/kontenery-shots.js`, `dema/kontenery.js` |
| `dema/mostki-demo.html` | tak |  |  | 1 (sunShadowMaskGLSL.js) | `dema/mostki-demo.js`, `dema/mostki-shots.js`, `dema/mostki3d-drzenie.js`, `dema/mostki3d-shots.js`, `dema/precyzja-drzenie.js` |
| `dema/rdzen-demo.html` | tak |  |  | 1 (sunShadowMaskGLSL.js) | `dema/rdzen-demo.js`, `dema/rdzen-gpu-check.js`, `dema/rdzen-shots.js` |
| `scripts/proxy-batch/index.html` | tak |  |  | 2 (sunShadowMaskGLSL.js, shipProxyBatch3D.js) | `scripts/proxy-batch/gallery.mjs`, `scripts/proxy-batch/lighting.mjs`, `scripts/proxy-batch/precision.mjs`, `scripts/proxy-batch/run.mjs`, `scripts/webgpu/inwentarz.mjs` |
| `scripts/webgpu/ring-tsl-parzystosc-strona.html` |  |  | tak | 1 (haloRingGLSL.js) | `scripts/webgpu/ring-tsl-parzystosc.mjs` |
| `scripts/webgpu/tarcze-parzystosc-strona.html` | tak | tak | tak | 1 (sunShadowMaskGLSL.js) | `scripts/webgpu/tarcze-parzystosc.mjs` |
| `destruktor2d.html` |  | tak |  | 2 (beamShips3D.js, beamDebris3D.js) |  |
| `destruktor3d.html` |  | tak |  | 2 (beamShips3D.js, beamDebris3D.js) |  |

## Testy czytające shadery / strukturę Core3D (kandydaci do przepisania)

| test | moduły z GLSL / core3d |
|---|---|
| `tests/beamShips3D.test.mjs` | `src/3d/beamShips3D.js` |
| `tests/beamSkinSurface3D.test.mjs` | `src/3d/beamShips3D.js` |
| `tests/bloomCompute.test.mjs` | `src/3d/core3d.js` |
| `tests/cargoContainers3D.test.mjs` | `src/3d/cargoContainers3D.js`, `src/3d/cargoDrones3D.js` |
| `tests/fx3dTSL.test.mjs` | `src/3d/core3d.js` |
| `tests/fxCore3D.test.mjs` | `src/3d/core3d.js` |
| `tests/graBezGlsl.test.mjs` | `src/3d/core3d.js` |
| `tests/haloRingK7ArchTSL.test.mjs` | `src/3d/haloRing/haloRingGLSL.js` |
| `tests/haloRingMegaCityTSL.test.mjs` | `src/3d/haloRing/haloRingGLSL.js` |
| `tests/haloRingStructureTSL.test.mjs` | `src/3d/haloRing/haloRingGLSL.js` |
| `tests/haloRingTerrainTSL.test.mjs` | `src/3d/haloRing/haloRingGLSL.js` |
| `tests/hexShips3DShader.test.mjs` | `src/3d/core3d.js` |
| `tests/hullDamageMap.test.mjs` | `src/3d/core3d.js` |
| `tests/menuBackdrop.test.mjs` | `src/3d/core3d.js` |
| `tests/mostkiRdzenieTSL.test.mjs` | `src/3d/core3d.js` |
| `tests/overlayContextMerge.test.mjs` | `src/3d/core3d.js` |
| `tests/perfInstrumentation.test.mjs` | `src/3d/core3d.js` |
| `tests/portBuildings.test.mjs` | `src/3d/portBuildings/portBuildings3D.js`, `src/3d/portBuildings/portBuoys3D.js`, `src/3d/portBuildings/portHullBuild3D.js`, `src/3d/core3d.js` |
| `tests/renderPerfGates.test.mjs` | `src/3d/core3d.js` |
| `tests/ringPlanetAnchoring.test.mjs` | `src/3d/core3d.js` |
| `tests/rocketFx.test.mjs` | `src/3d/core3d.js` |
| `tests/rozgrzewka.test.mjs` | `src/3d/core3d.js` |
| `tests/sceneMatrixSync.test.mjs` | `src/3d/core3d.js` |
| `tests/shadowShaftsQuality.test.mjs` | `src/3d/haloRing/haloRingGLSL.js`, `src/3d/sunShadowMaskGLSL.js`, `src/3d/core3d.js` |
| `tests/shipLights3D.test.mjs` | `src/3d/core3d.js` |
| `tests/shipProxyBatch3D.test.mjs` | `src/3d/shipProxyBatch3D.js`, `src/3d/core3d.js` |
| `tests/sunShadowMaskTSL.test.mjs` | `src/3d/core3d.js` |
| `tests/warpNurt.test.mjs` | `src/3d/core3d.js` |
| `tests/webgpuFundament.test.mjs` | `src/3d/core3d.js` |
| `tests/webgpuPost.test.mjs` | `src/3d/core3d.js` |
| `tests/zniszczenieStacjiTSL.test.mjs` | `src/3d/core3d.js` |
