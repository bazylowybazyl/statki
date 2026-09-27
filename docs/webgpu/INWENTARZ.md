# Inwentarz portu WebGPU

> Wygenerowane przez `node scripts/webgpu/inwentarz.mjs` — **nie edytować ręcznie**, uruchomić ponownie.
> Stan: 2026-09-27, HEAD `refs/heads/main`. Surowe dane: `.tmp/webgpu/inwentarz.json`.
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
| **razem** | 60 | 105 (102 SM, 0 Raw, 3 ShaderPass) | 12263 | 1 | 2 | 5 | 61 | 6 / 36 / 23 | 19 / 2 |
| port | 38 | 59 (58 SM, 0 Raw, 1 ShaderPass) | 7326 | 1 | 1 | 5 | 49 | 6 / 27 / 17 | 14 / 2 |
| warp | 2 | 2 (2 SM, 0 Raw, 0 ShaderPass) | 364 | 0 | 0 | 0 | 1 | 0 / 0 / 0 | 0 / 0 |
| asteroidy-stare | 1 | 1 (1 SM, 0 Raw, 0 ShaderPass) | 66 | 0 | 0 | 0 | 2 | 0 / 3 / 0 | 0 / 0 |
| asteroidy-nowe | 7 | 15 (15 SM, 0 Raw, 0 ShaderPass) | 1889 | 0 | 1 | 0 | 0 | 0 / 0 / 1 | 0 / 0 |
| legacy | 1 | 5 (3 SM, 0 Raw, 2 ShaderPass) | 392 | 0 | 0 | 0 | 2 | 0 / 2 / 0 | 0 / 0 |
| poza grą | 11 | 23 (23 SM, 0 Raw, 0 ShaderPass) | 2226 | 0 | 0 | 0 | 7 | 0 / 4 / 5 | 5 / 0 |

### Porównanie z `USTALENIA.md` (~105 materiałów w 53 plikach, ~12,7 tys. linii GLSL w 59 plikach)

Tu: **105 miejsc tworzenia materiałów** (w tym 3 `ShaderPass`) w 53 plikach,
**12263 linii GLSL** w 59 plikach. Różnice: (1) ten lekser liczy szablony w całości
(z `${…}`) i także krótkie jednolinijkowe shadery w zwykłych napisach; (2) liczy `ShaderPass` jako materiał; (3) pliki dodane od
`2c2ef18` (ringi-archetypy Z6 `haloRing/arch/*`, budowle portowe Z7, burze pasa). Do planu liczy się wiersz **port**.

## Pliki w porcie (ładuje je gra)

| plik | mat. | linie GLSL | oBC | cele renderu | odczyty | compile | inne WebGL / post | wbudowane mat. | przebudowy (clone / needsUpdate / defines) | status | uwagi |
|---|---:|---:|---:|---|---:|---:|---|---:|---|---|---|
| `src/3d/haloRing/haloRingStructure.js` | 1 | 564 |  |  |  |  |  |  | · / · / 1 | GLSL |  |
| `src/3d/haloRing/haloRingGLSL.js` |  | 562 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/haloRing/haloRingMegastructure.js` | 4 | 535 |  |  |  |  |  |  | · / · / 7 | GLSL |  |
| `src/3d/haloRing/arch/archGLSL.js` |  | 424 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/bridge3D.js` | 3 | 420 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/shield3D.js` | 2 | 398 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/haloRing/haloRingCity.js` | 3 | 375 |  |  |  |  |  |  | · / · / 3 | GLSL |  |
| `src/3d/warpPlume3D.js` | 3 | 330 |  |  |  |  |  |  | · / · / 1 | GLSL |  |
| `src/effects3d/yamato.js` | 2 | 328 |  |  |  |  |  |  | · / · / · | GLSL | scena overlay; zastąpią receptury dema broni (zadanie 17) |
| `src/3d/haloRing/haloPortK7.js` | 4 | 278 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/effects3d/supernovaMissileBlow.js` | 2 | 230 |  |  |  |  |  |  | · / · / · | GLSL | scena overlay; zastąpi Supernowa z dema rakiet (zadanie 19) |
| `src/effects3d/reactorblow.js` | 2 | 226 |  |  |  |  |  |  | · / · / · | GLSL | scena overlay; port do Core3D w zadaniu 20 |
| `src/effects3d/rocketFireGPU.js` | 1 | 213 |  |  |  |  |  |  | · / · / · | GLSL | zastąpi dym i dysze z dema rakiet (zadanie 19) |
| `src/3d/menuBackdrop3D.js` | 3 | 200 |  |  |  | 2 | initTexture |  | · / · / · | GLSL | rozgrzewka po kluczu programu WebGL — do przeprojektowania |
| `src/3d/planet3d.assets.js` | 7 | 191 |  |  |  |  |  | 3 | · / · / · | GLSL |  |
| `src/3d/shieldImpactFx.js` | 2 | 185 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/haloRing/arch/fable.js` | 1 | 178 |  |  |  |  |  |  | · / 2 / · | GLSL |  |
| `src/3d/haloRing/arch/ecumene.js` | 1 | 171 |  |  |  |  |  |  | · / 2 / · | GLSL |  |
| `src/3d/core3d.js` |  | 148 |  | RenderTarget×4 |  | 1 | initTexture | 2 | · / · / · | mieszany | serce portu: WebGPURenderer, passy sceny (zadanie 01), post w TSL — bloom i uber z gorącym powietrzem w src/3d/tsl/postGry.js (zadanie 02); zostało źródło GLSL maski słońca (03); soczewka i fale warpa usunięte |
| `src/vfx/shatterMaterial.js` | 1 | 143 |  |  |  |  |  |  | · / · / · | GLSL | zniszczenie stacji |
| `src/3d/engineExhaustBatch.js` | 2 | 139 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/haloRing/haloRingAtmosphere.js` | 2 | 135 |  |  |  |  |  |  | · / · / 2 | GLSL |  |
| `src/3d/haloRing/haloRingIndustryKit.js` |  | 127 |  |  |  |  |  |  | · / · / · | mieszany |  |
| `src/3d/sparkSystem3D.js` | 1 | 112 |  |  |  |  |  |  | · / · / · | GLSL | scena overlay; zastąpi sparks.js z dema rakiet (zadanie 19) |
| `Engineeffects.js` | 1 | 90 |  |  |  |  | WebGLRenderer, renderer.state | 3 | · / · / · | GLSL | gra importuje tylko tekstury make*Texture; getEngineVFX z własnym WebGLRenderer i shader — martwe |
| `src/3d/slugTrail3D.js` | 1 | 75 |  |  |  |  |  |  | · / · / 1 | GLSL | zastąpi TrailSystem z dema broni (zadanie 17) |
| `src/effects3d/rocketSmokeGPU.js` | 1 | 74 |  |  |  |  |  |  | · / · / · | GLSL | zastąpi dym z dema rakiet (zadanie 19) |
| `src/3d/hullShadowSdf.js` |  | 69 |  |  |  |  |  |  | · / · / · | GLSL | biblioteka SDF kadłubów; lustro CPU traceHullShadowCpu (test) |
| `src/3d/fxParticles3D.js` | 1 | 67 |  |  |  |  |  | 2 | · / · / · | GLSL | Fx3D: port 1:1 w zadaniu 12 (dysze MAIN, mostki, rdzenie) |
| `src/3d/beamDebris3D.js` | 1 | 64 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/effects3d/shockwave3D.js` | 1 | 50 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/mainExhaust3D.js` | 1 | 48 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/shipLights3D.js` | 1 | 43 |  |  |  |  |  |  | · / 1 / · | GLSL |  |
| `src/effects3d/overlay.js` | 1 | 36 |  | WebGLRenderTarget |  |  | WebGLRenderer, EffectComposer, RenderPass, UnrealBloomPass, ShaderPass |  | · / · / · | GLSL | DRUGI WebGLRenderer (overlay3D eksplozji + rakiety, własny composer i bloom) — zostaje w porcie, usuwa go zadanie 20 |
| `src/3d/sunShadowMask.js` |  | 36 | 1 |  |  |  |  |  | · / 1 / · | GLSL | biblioteka maski słońca + onBeforeCompile dla wbudowanych materiałów |
| `src/3d/bridgeFx3D.js` | 1 | 33 |  |  |  |  |  |  | · / 1 / · | GLSL |  |
| `src/vfx/destruction3D.js` | 1 | 29 |  |  |  |  |  |  | 2 / · / · | GLSL | zniszczenie stacji |
| `src/3d/haloRing/arch/archMaterials.js` | 1 |  |  |  |  |  |  |  | · / 1 / 2 | GLSL |  |
| `src/3d/coldWreckImpostors.js` |  |  |  |  |  |  |  |  | · / · / · | — | uśpione (wymaga hexGrid) |
| `src/3d/haloRing/haloRingDetail.js` |  |  |  | RenderTarget |  | 1 |  |  | · / · / · | TSL |  |
| `src/3d/haloRing/haloRingWorldGen.js` |  |  |  | RenderTarget×2 | 1 | 1 |  |  | · / · / · | TSL | pieczenie map + odczyt CPU (WebGPU: asynchronicznie, bez odwracania osi — zadanie 06) |
| `src/3d/hexShips3D.js` |  |  |  |  |  |  |  |  | · / 1 / · | TSL | kadłuby = gałąź beam (BEAM_SKIN + HEX_FRAGMENT); gałąź heksów (HEX/ARMOR/DEBRIS, pula szczątków GPU) w grze rysuje tylko wyłączone asteroidy, ale stoją na niej mostki-demo, rdzen-demo i pomiar drżenia → port w zadaniu 04 |
| `src/3d/muzzleFx3D.js` |  |  |  |  |  |  |  |  | · / · / · | — | zastąpią receptury dema broni (zadanie 17) |
| `src/3d/railgunFx3D.js` |  |  |  |  |  |  |  |  | · / · / · | — | zastąpią receptury dema broni (zadanie 17) |
| `src/3d/weapon3DSystem.js` |  |  |  |  |  |  |  | 8 | · / 6 / · | — | zastąpią pule i receptury dema broni (zadania 17–18); klony materiałów wiązek w puli ≤ 96 |
| `src/effects3d/armataImpact.js` |  |  |  |  |  |  |  | 6 | · / 2 / · | — | scena overlay; zastąpią receptury dema broni (zadanie 17) |
| `src/effects3d/autocannonImpact.js` |  |  |  |  |  |  |  | 7 | · / 4 / · | — | scena overlay; zastąpią receptury dema broni (zadanie 17) |
| `src/effects3d/railgunExplosion.js` |  |  |  |  |  |  |  | 4 | 2 / 1 / · | — | scena overlay; zastąpią receptury dema broni (zadanie 17) |
| `src/effects3d/rocketSystem3D.js` |  |  |  |  |  |  |  | 1 | · / 2 / · | — | lot i trafienia rakiet (rozgrywka) zostają; render zastąpi demo rakiet (zadanie 19) |

## Poza portem — decyzje użytkownika

### Warp
| plik | mat. | linie GLSL | oBC | cele renderu | odczyty | compile | inne WebGL / post | wbudowane mat. | przebudowy (clone / needsUpdate / defines) | status | uwagi |
|---|---:|---:|---:|---|---:|---:|---|---:|---|---|---|
| `src/3d/warpLens3D.js` |  | 197 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/warpFx3D.js` | 2 | 167 |  |  |  |  |  |  | · / · / · | GLSL |  |

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
| `src/3d/coreFx3D.js` | 3 | 280 |  |  |  |  |  |  | · / · / · | GLSL |  |
| `src/3d/portBuildings/portBuildings3D.js` | 1 | 267 |  |  |  |  |  |  | · / · / 3 | GLSL |  |
| `src/3d/reactor3D.js` | 2 | 222 |  |  |  |  |  |  | · / · / · | GLSL |  |
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
- `src/3d/haloRing/arch/archGLSL.js` (424 linii GLSL)
  - `ARCH_GLASS_FRAGMENT` → `src/3d/haloRing/arch/archMaterials.js`
  - `ARCH_GLASS_VERTEX` → `src/3d/haloRing/arch/archMaterials.js`
  - `ARCH_GLSL_LIT` → `src/3d/haloRing/arch/ecumene.js`, `src/3d/haloRing/arch/fable.js`
  - `ARCH_INSTANCED_FRAGMENT` → `src/3d/haloRing/arch/archMaterials.js`
  - `ARCH_INSTANCED_VERTEX` → `src/3d/haloRing/arch/archMaterials.js`
  - `ARCH_LINE_FRAGMENT` → `src/3d/haloRing/arch/archMaterials.js`
  - `ARCH_LINE_VERTEX` → `src/3d/haloRing/arch/archMaterials.js`
  - `ARCH_POINTS_FRAGMENT` → `src/3d/haloRing/arch/archMaterials.js`
  - `ARCH_POINTS_VERTEX` → `src/3d/haloRing/arch/archMaterials.js`
  - `ARCH_STRIP_FRAGMENT` → `src/3d/haloRing/arch/archMaterials.js`
  - `ARCH_STRIP_VERTEX` → `src/3d/haloRing/arch/archMaterials.js`
- `src/3d/haloRing/haloRingGLSL.js` (562 linii GLSL)
  - `HALO_GLSL_AIR` → `src/3d/haloRing/haloRingAtmosphere.js`, `src/3d/haloRing/haloRingCity.js`, `src/3d/haloRing/haloRingMegastructure.js`, `src/3d/haloRing/haloRingStructure.js`
  - `HALO_GLSL_CLOUDCOVER` → `src/3d/haloRing/haloRingAtmosphere.js`
  - `HALO_GLSL_COMMON` → `src/3d/haloRing/arch/archGLSL.js`, `src/3d/haloRing/arch/ecumene.js`, `src/3d/haloRing/arch/fable.js`, `src/3d/haloRing/haloPortK7.js`, `src/3d/haloRing/haloRingAtmosphere.js`, `src/3d/haloRing/haloRingCity.js`, `src/3d/haloRing/haloRingMegastructure.js`, `src/3d/haloRing/haloRingStructure.js`, `src/3d/menuBackdrop3D.js`, `src/3d/portBuildings/portBuildings3D.js`, `src/3d/portBuildings/portHullBuild3D.js`
  - `HALO_GLSL_FG` → `src/3d/haloRing/arch/archGLSL.js`, `src/3d/haloRing/arch/ecumene.js`, `src/3d/haloRing/arch/fable.js`, `src/3d/haloRing/haloRingMegastructure.js`, `src/3d/haloRing/haloRingStructure.js`
  - `HALO_GLSL_FG_CLIP` → `src/3d/haloRing/arch/archGLSL.js`, `src/3d/haloRing/arch/ecumene.js`, `src/3d/haloRing/arch/fable.js`, `src/3d/haloRing/haloRingMegastructure.js`, `src/3d/haloRing/haloRingStructure.js`
  - `HALO_GLSL_LIGHT` → `src/3d/haloRing/arch/archGLSL.js`, `src/3d/haloRing/arch/ecumene.js`, `src/3d/haloRing/arch/fable.js`, `src/3d/haloRing/haloPortK7.js`, `src/3d/haloRing/haloRingAtmosphere.js`, `src/3d/haloRing/haloRingCity.js`, `src/3d/haloRing/haloRingMegastructure.js`, `src/3d/haloRing/haloRingStructure.js`, `src/3d/menuBackdrop3D.js`, `src/3d/portBuildings/portBuildings3D.js`, `src/3d/portBuildings/portHullBuild3D.js`
  - `HALO_GLSL_NOISE` → `src/3d/haloRing/arch/archGLSL.js`, `src/3d/haloRing/arch/ecumene.js`, `src/3d/haloRing/arch/fable.js`, `src/3d/haloRing/haloPortK7.js`, `src/3d/haloRing/haloRingAtmosphere.js`, `src/3d/haloRing/haloRingCity.js`, `src/3d/haloRing/haloRingMegastructure.js`, `src/3d/haloRing/haloRingStructure.js`, `src/3d/portBuildings/portBuildings3D.js`, `src/3d/portBuildings/portHullBuild3D.js`
  - `HALO_GLSL_PORTSITES` → `src/3d/haloRing/arch/ecumene.js`
  - `HALO_GLSL_RTE` → `src/3d/haloRing/haloRingAtmosphere.js`, `src/3d/haloRing/haloRingCity.js`, `src/3d/haloRing/haloRingMegastructure.js`, `src/3d/haloRing/haloRingStructure.js`
  - `HALO_GLSL_STORM` → `src/3d/haloRing/haloRingAtmosphere.js`
  - `HALO_GLSL_SURFACE` → `src/3d/haloRing/haloRingAtmosphere.js`, `src/3d/haloRing/haloRingCity.js`, `src/3d/haloRing/haloRingMegastructure.js`, `src/3d/haloRing/haloRingStructure.js`
- `src/3d/haloRing/haloRingIndustryKit.js` (127 linii GLSL)
  - `HALO_GLSL_INDKIT` → `src/3d/haloRing/haloRingCity.js`
- `src/3d/haloRing/haloRingMegastructure.js` (535 linii GLSL)
  - `HALO_PRIM_FRAGMENT` → `src/3d/haloRing/haloRingCity.js`
- `src/3d/haloRing/haloRingStructure.js` (564 linii GLSL)
  - `HALO_GLSL_STRIP_VERTEX` → `src/3d/haloRing/haloRingAtmosphere.js`
- `src/3d/hullShadowSdf.js` (69 linii GLSL)
  - `HULL_SDF_SHADOW_GLSL` → `src/3d/core3d.js`
- `src/3d/rocks/rockShapes3D.js` (228 linii GLSL)
  - `ROCK_OCT_GLSL` → `src/3d/rocks/rockMaterial3D.js`
- `src/3d/sunShadowMask.js` (36 linii GLSL)
  - `applySunShadowToBuiltinMaterial` → `src/3d/asteroidBeltBackdrop3D.js`, `src/3d/planet3d.assets.js`
  - `SUN_SHADOW_GLSL` → `src/3d/asteroidBeltBackdrop3D.js`, `src/3d/bridge3D.js`, `src/3d/cargoContainers3D.js`, `src/3d/cargoDrones3D.js`, `src/3d/planet3d.assets.js`, `src/3d/portBuildings/portBuildings3D.js`, `src/3d/portBuildings/portHullBuild3D.js`, `src/3d/rocks/giantRock3D.js`, `src/3d/rocks/rockMaterial3D.js`, `src/3d/rocks/rockMinerals3D.js`, `src/3d/shipProxyBatch3D.js`

## Największe bloki GLSL

| plik:linia | nazwa | linie | zakres |
|---|---|---:|---|
| `src/3d/rocks/rockMaterial3D.js:328` | `ROCK_FRAGMENT` | 457 | asteroidy-nowe |
| `src/3d/haloRing/haloRingStructure.js:66` | `HALO_GLSL_ROOF` | 309 | port |
| `src/3d/haloRing/haloRingMegastructure.js:123` | `HALO_PRIM_FRAGMENT` | 297 | port |
| `src/3d/rocks/rockMinerals3D.js:403` | `MINERAL_FRAGMENT` | 285 | asteroidy-nowe |
| `src/3d/cargoContainers3D.js:262` | `CONTAINER_FRAG` | 224 | poza grą (dema) |
| `src/3d/haloRing/haloRingStructure.js:376` | `STRUCTURE_FRAGMENT` | 221 | port |
| `src/3d/warpPlume3D.js:95` | `—` | 197 | port |
| `src/3d/warpLens3D.js:415` | `fragmentShader:` | 196 | warp |
| `src/3d/rocks/giantRock3D.js:134` | `GIANT_FRAGMENT` | 192 | asteroidy-nowe |
| `src/effects3d/stationDestructionEffects.js:54` | `vertexShader:` | 172 | poza grą (nieużywany) |
| `src/3d/haloRing/arch/archGLSL.js:116` | `ARCH_INSTANCED_FRAGMENT` | 169 | port |
| `src/3d/haloRing/arch/fable.js:41` | `FAB_SURFACE_FRAGMENT` | 165 | port |
| `src/effects3d/yamato.js:57` | `vertexShader:` | 165 | port |
| `src/3d/shield3D.js:306` | `HULL_SHIELD_FRAGMENT` | 164 | port |
| `src/3d/haloRing/arch/ecumene.js:51` | `ECU_SURFACE_FRAGMENT` | 158 | port |
| `src/effects3d/rocketFireGPU.js:133` | `vertexShader:` | 153 | port |
| `src/3d/bridge3D.js:382` | `MODEL_FRAG` | 148 | port |
| `src/3d/core3d.js:127` | `fragmentShader:` | 147 | port |
| `planet3d.proc.js:7` | `NOISE_FUNCTIONS` | 145 | legacy |
| `planet3d.proc.js:202` | `PLANET_FRAG` | 131 | legacy |
| `src/3d/haloRing/haloRingIndustryKit.js:373` | `HALO_GLSL_INDKIT` | 127 | port |
| `src/3d/rocks/rockShapes3D.js:308` | `—` | 124 | asteroidy-nowe |
| `src/3d/haloRing/haloRingCity.js:284` | `TREE_VERTEX` | 121 | port |
| `src/3d/portBuildings/portBuildings3D.js:150` | `PB_GLSL_SURFACE` | 120 | poza grą (dema) |
| `src/3d/shield3D.js:163` | `SHIELD_FRAGMENT` | 119 | port |
| `src/vfx/shatterMaterial.js:43` | `VERT` | 118 | port |
| `src/3d/shieldImpactFx.js:94` | `VERTEX_SHADER` | 113 | port |
| `src/effects3d/supernovaMissileBlow.js:48` | `vertexShader:` | 110 | port |
| `src/3d/haloRing/haloRingGLSL.js:202` | `HALO_GLSL_LIGHT` | 109 | port |
| `src/3d/warpFx3D.js:82` | `GLYPH_FRAG` | 108 | warp |
| `src/3d/haloRing/haloPortK7.js:43` | `GLSL_K7_SURFACE` | 107 | port |
| `src/3d/haloRing/haloRingCity.js:73` | `GARDEN_VERTEX` | 107 | port |
| `src/3d/bridge3D.js:232` | `B3_FUNC_GLSL` | 102 | port |
| `src/3d/haloRing/haloRingGLSL.js:80` | `HALO_GLSL_NOISE` | 98 | port |
| `src/3d/portBuildings/portHullBuild3D.js:95` | `HULL_FRAGMENT` | 98 | poza grą (dema) |
| `src/3d/haloRing/haloRingCity.js:182` | `INDUSTRY_VERTEX` | 96 | port |
| `src/effects3d/reactorblow.js:52` | `vertexShader:` | 94 | port |
| `src/3d/haloRing/haloRingMegastructure.js:426` | `GLASS_FRAGMENT` | 93 | port |
| `src/3d/reactor3D.js:170` | `STRUCT_FRAGMENT` | 90 | poza grą (dema) |
| `src/3d/haloRing/haloRingGLSL.js:312` | `HALO_GLSL_AIR` | 88 | port |

## Przebudowy materiałów w locie (zakres: port)

`clone()` / `needsUpdate = true` (heurystyka: zmienna z „mat” w nazwie):

- needsUpdate — src/3d/bridgeFx3D.js:301
- needsUpdate — src/3d/haloRing/arch/archMaterials.js:132
- needsUpdate — src/3d/haloRing/arch/ecumene.js:603
- needsUpdate — src/3d/haloRing/arch/ecumene.js:623
- needsUpdate — src/3d/haloRing/arch/fable.js:551
- needsUpdate — src/3d/haloRing/arch/fable.js:573
- needsUpdate — src/3d/hexShips3D.js:1387
- needsUpdate — src/3d/shipLights3D.js:206
- needsUpdate — src/3d/sunShadowMask.js:129
- needsUpdate — src/3d/weapon3DSystem.js:655
- needsUpdate — src/3d/weapon3DSystem.js:804
- needsUpdate — src/3d/weapon3DSystem.js:1313
- needsUpdate — src/3d/weapon3DSystem.js:1314
- needsUpdate — src/3d/weapon3DSystem.js:1315
- needsUpdate — src/3d/weapon3DSystem.js:1316
- needsUpdate — src/effects3d/armataImpact.js:102
- needsUpdate — src/effects3d/armataImpact.js:192
- needsUpdate — src/effects3d/autocannonImpact.js:143
- needsUpdate — src/effects3d/autocannonImpact.js:176
- needsUpdate — src/effects3d/autocannonImpact.js:267
- needsUpdate — src/effects3d/autocannonImpact.js:284
- clone — src/effects3d/railgunExplosion.js:80
- clone — src/effects3d/railgunExplosion.js:104
- needsUpdate — src/effects3d/railgunExplosion.js:165
- needsUpdate — src/effects3d/rocketSystem3D.js:336
- needsUpdate — src/effects3d/rocketSystem3D.js:839
- clone — src/vfx/destruction3D.js:681
- clone — src/vfx/destruction3D.js:933
- clone — src/vfx/panelShardManager.js:289
- clone — src/vfx/panelShardManager.js:298
- needsUpdate — src/vfx/panelShardManager.js:145
- needsUpdate — src/vfx/panelShardManager.js:172
- needsUpdate — src/vfx/panelShardManager.js:217

`defines` w plikach: `src/3d/haloRing/arch/archMaterials.js` (2), `src/3d/haloRing/haloRingAtmosphere.js` (2), `src/3d/haloRing/haloRingCity.js` (3), `src/3d/haloRing/haloRingMegastructure.js` (7), `src/3d/haloRing/haloRingStructure.js` (1), `src/3d/slugTrail3D.js` (1), `src/3d/warpPlume3D.js` (1).

## Strony dem i narzędzi korzystające z shaderów gry

| strona | Core3D | własny WebGLRenderer | WebGPU | moduły gry z GLSL | używana przez |
|---|---|---|---|---|---|
| `dema/asteroidy.html` | tak |  |  | 20 (planet3d.assets.js, sunShadowMask.js, core3d.js, hullShadowSdf.js, shockwave3D.js …(+15)) | `dema/asteroidy-webgpu.js`, `dema/asteroidy.js` |
| `dema/budowle-portowe.html` | tak |  |  | 17 (portBuoys3D.js, core3d.js, sunShadowMask.js, hullShadowSdf.js, shockwave3D.js …(+12)) | `dema/budowle-portowe-shots.js`, `dema/budowle-portowe.js` |
| `dema/halo_ring_demo.html` |  |  | tak | 11 (fable.js, archMaterials.js, archGLSL.js, haloRingGLSL.js, ecumene.js …(+6)) | `dema/halo_ring_demo.js`, `scripts/halo-ring-shots.mjs` |
| `dema/kontenery.html` |  | tak | tak | 10 (cargoDrones3D.js, sunShadowMask.js, cargoContainers3D.js, haloPortK7.js, haloRingGLSL.js …(+5)) | `dema/kontenery-shots.js`, `dema/kontenery.js` |
| `dema/mostki-demo.html` | tak |  |  | 14 (bridge3D.js, sunShadowMask.js, bridgeFx3D.js, core3d.js, hullShadowSdf.js …(+9)) | `dema/mostki-demo.js`, `dema/mostki-shots.js`, `dema/mostki3d-drzenie.js`, `dema/mostki3d-shots.js`, `dema/precyzja-drzenie.js` |
| `dema/rdzen-demo.html` | tak |  |  | 17 (core3d.js, sunShadowMask.js, hullShadowSdf.js, shockwave3D.js, beamDebris3D.js …(+12)) | `dema/rdzen-demo.js`, `dema/rdzen-gpu-check.js`, `dema/rdzen-shots.js` |
| `dema/warp-demo.html` | tak |  |  | 15 (planet3d.assets.js, sunShadowMask.js, core3d.js, hullShadowSdf.js, shockwave3D.js …(+10)) | `dema/warp-demo.js` |
| `scripts/proxy-batch/index.html` | tak |  |  | 13 (core3d.js, sunShadowMask.js, hullShadowSdf.js, shockwave3D.js, beamDebris3D.js …(+8)) | `scripts/proxy-batch/gallery.mjs`, `scripts/proxy-batch/lighting.mjs`, `scripts/proxy-batch/precision.mjs`, `scripts/proxy-batch/run.mjs`, `scripts/webgpu/inwentarz.mjs` |
| `scripts/webgpu/ring-mapa-strona.html` |  | tak |  | 6 (fable.js, archMaterials.js, archGLSL.js, haloRingGLSL.js, ecumene.js …(+1)) | `scripts/webgpu/ring-mapa.mjs` |
| `scripts/webgpu/ring-tsl-parzystosc-strona.html` |  |  | tak | 2 (haloRingIndustryKit.js, haloRingGLSL.js) | `scripts/webgpu/ring-tsl-parzystosc.mjs` |
| `destruktor2d.html` |  | tak |  | 2 (beamShips3D.js, beamDebris3D.js) |  |
| `destruktor3d.html` |  | tak |  | 2 (beamShips3D.js, beamDebris3D.js) |  |

## Testy czytające shadery / strukturę Core3D (kandydaci do przepisania)

| test | moduły z GLSL / core3d |
|---|---|
| `tests/beamShips3D.test.mjs` | `src/3d/beamShips3D.js` |
| `tests/beamSkinSurface3D.test.mjs` | `src/3d/beamShips3D.js` |
| `tests/cargoContainers3D.test.mjs` | `src/3d/cargoContainers3D.js`, `src/3d/cargoDrones3D.js` |
| `tests/haloRingArch.test.mjs` | `src/3d/haloRing/arch/archGLSL.js`, `src/3d/haloRing/arch/ecumene.js`, `src/3d/haloRing/arch/fable.js` |
| `tests/haloRingTerrainTSL.test.mjs` | `src/3d/haloRing/haloRingAtmosphere.js`, `src/3d/haloRing/haloRingCity.js`, `src/3d/haloRing/haloRingGLSL.js`, `src/3d/haloRing/haloRingIndustryKit.js`, `src/3d/haloRing/haloRingMegastructure.js` …(+1) |
| `tests/hexShips3DShader.test.mjs` | `src/3d/core3d.js` |
| `tests/hullShadowSdf.test.mjs` | `src/3d/hullShadowSdf.js` |
| `tests/menuBackdrop.test.mjs` | `src/3d/core3d.js`, `src/3d/menuBackdrop3D.js`, `src/3d/planet3d.assets.js` |
| `tests/overlayContextMerge.test.mjs` | `src/effects3d/overlay.js` |
| `tests/perfInstrumentation.test.mjs` | `src/3d/core3d.js`, `Engineeffects.js` |
| `tests/portBuildings.test.mjs` | `src/3d/core3d.js`, `src/3d/portBuildings/portBuildings3D.js`, `src/3d/portBuildings/portBuoys3D.js`, `src/3d/portBuildings/portHullBuild3D.js` |
| `tests/renderPerfGates.test.mjs` | `src/3d/core3d.js`, `src/3d/planet3d.assets.js`, `src/3d/shield3D.js`, `src/3d/shieldImpactFx.js`, `src/effects3d/overlay.js` …(+5) |
| `tests/ringPlanetAnchoring.test.mjs` | `src/3d/core3d.js`, `src/3d/planet3d.assets.js` |
| `tests/sceneMatrixSync.test.mjs` | `src/3d/core3d.js`, `src/effects3d/shockwave3D.js` |
| `tests/shaderPrewarm.test.mjs` | `src/3d/shield3D.js`, `src/effects3d/overlay.js` |
| `tests/shadowShaftsQuality.test.mjs` | `src/3d/asteroidBeltBackdrop3D.js`, `src/3d/bridge3D.js`, `src/3d/bridgeFx3D.js`, `src/3d/core3d.js`, `src/3d/engineExhaustBatch.js` …(+13) |
| `tests/shieldImpactFx.test.mjs` | `src/3d/shieldImpactFx.js` |
| `tests/shipLights3D.test.mjs` | `src/3d/core3d.js`, `src/3d/shipLights3D.js` |
| `tests/shipProxyBatch3D.test.mjs` | `src/3d/core3d.js`, `src/3d/shipProxyBatch3D.js` |
| `tests/starParallax.test.mjs` | `src/3d/planet3d.assets.js` |
| `tests/warpLens3D.test.mjs` | `src/3d/core3d.js`, `src/3d/warpLens3D.js` |
| `tests/warpPlume3D.test.mjs` | `src/3d/warpPlume3D.js` |
| `tests/warpSpace.test.mjs` | `src/3d/core3d.js`, `src/3d/warpLens3D.js` |
| `tests/webgpuFundament.test.mjs` | `src/3d/core3d.js`, `src/3d/shield3D.js`, `src/effects3d/overlay.js` |
| `tests/webgpuPost.test.mjs` | `src/3d/core3d.js` |
