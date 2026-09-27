# Zadanie 12 — Broń i cząstki w scenie Core3D: Fx3D, błyski wylotowe, railgun, smugi, pociski i wiązki
Zależności: 03 | Równolegle z: 04–10, 13, 14, 16, 17 | Zalecany effort: xhigh
Zakres: `src/3d/fxParticles3D.js` (`Fx3D`: jeden `ShaderMaterial` z fabryki `instancedQuad` w 7 systemach —
warianty wierzchołków `BB_VERT`, `PLUME_VERT`, `CROSS_VERT`, `WASH_VERT`, 67 linii GLSL; łuki i iskry Fx3D na
`LineBasicMaterial`), `src/3d/slugTrail3D.js` (1 materiał, 75 linii, `defines: { QUALITY_NOISE }`),
`src/3d/weapon3DSystem.js` (8 materiałów wbudowanych: pociski i błyski wylotowe na `InstancedMesh`, wiązki pulse /
ciągłe z pulą ≤ 96 i klonami materiałów przy tworzeniu wizuala, rozgrzewka wiązek), `src/3d/muzzleFx3D.js`,
`src/3d/railgunFx3D.js` (bez własnych materiałów — pule Fx3D i `SlugTrail`). 2 materiały / 142 linie GLSL + wbudowane.

## Cel
Pociski, smugi gazu, błyski wylotowe, efekty railguna, wiązki i cząstki Fx3D (dym, opary, iskry Fx3D, łuki) wyglądają
jak w bazie; warstwa ortho scen bitwy bez zamienników tych modułów. **Iskry trafień i tarcia (`SparkSystem3D`) żyją
w scenie overlay → zadanie 17**, nie tu (PLAN §9, „Scena overlay”).

## Przeczytaj najpierw
`agents.md` (Nośnik prędkości — cały akapit; Core3D: HDR-first; Moduły 3D: precyzja, `sceneOriginNearCamera`, początek
„lepki” w `slugTrail3D`, `forceSinglePass`), `docs/webgpu/PLAN.md` §3 (graf węzłów, światła), §4, §6,
`docs/webgpu/POSTEP.md` (także decyzja o nowych efektach broni — PLAN §12 p. 6), `docs/AUDYT-wydajnosc-bitwa-2026-09-24.md`
§2.2, pliki zakresu, testy: `weapon3DModelMaterials`, `pulseBeamPoolLimit`, `beamRenderPath`, `carrierVelocity`,
`fighterCombatFixes`, `shadowShaftsQuality`, `renderPerfGates`.

## Kroki
1. **Fx3D:** `instancedQuad` → fabryka materiału węzłowego; cztery grafy (BB, PLUME, CROSS, WASH) budowane RAZ na moduł
   i współdzielone przez systemy (PLAN §3), atrybuty instancji przez węzły atrybutów, `depthTest: false`, kolejność z
   `renderOrder` (pass ortho układa broń renderOrderem). Bufory świata `Float64Array` → `Float32` względem `ORIGIN`
   (`sceneOriginNearCamera` co klatkę) — bez zmian. `LineBasicMaterial` (łuki, iskry Fx3D) konwertują się same —
   sprawdź `vertexColors` i HDR.
2. **`slugTrail3D`:** `QUALITY_NOISE` z `defines` → stała przy budowie grafu (zmiana jakości = nowy materiał raz) albo
   uniform; początek „lepki” bez zmian.
3. **`weapon3DSystem`:** materiały wbudowane (konwersja automatyczna) — sprawdź kolory > 1 (HDR), `instanceColor`,
   `forceSinglePass`. Klony materiałów wiązek przy tworzeniu wizuala w puli (≤ 96 pulse, `MAX_PULSE_BEAM_VISUALS`) mają
   klucz wspólny z oryginałem — tanie, zostaw. Rozgrzewka wiązek (`:838-870`, `compileAsync` od 01) → rozgrzewka passa
   ortho (cel `composerTarget`, warstwa 0, obiekty w kadrze — PLAN §6). `impactLight` zostaje wyłączone
   (`BEAM_ENABLE_IMPACT_LIGHT = false`; PLAN §3 — światła). `needsUpdate` z inwentarza to w większości
   `instanceMatrix.needsUpdate` (atrybut, nie przebudowa materiału) — bez zmian.
4. **Nośnik:** rysowanie `pos + v · (T − t0)` z `SimClock` zostaje w JS; test `carrierVelocity` (Fx3D: dym z lufy leci
   z okrętem) musi przejść bez zmian.
5. **Testy:** przepisz tylko asercje czytające GLSL (`weapon3DModelMaterials` — „projectile materials keep their HDR
   glow”, `shadowShaftsQuality` — emitery nie czytają maski, `renderPerfGates`); testy zachowania bez zmian.

## Pułapki
- Emitery nie czytają maski słońca (agents.md, test).
- Pass ortho = MSAA + HalfFloat: clamp varyingów, bez `pow` z możliwie ujemną podstawą — NaN rozlewa bloom na cały ekran
  (w WGSL `pow` z ujemną podstawą też daje NaN).
- Przezroczyste bez głębi: three WebGPU sortuje jak WebGL (`renderOrder`, potem z) — sprawdź kolejność warstw efektów
  na `bitwa-blisko` (dym pod błyskiem, smuga pod rdzeniem pocisku).
- Zero alokacji per klatka (pule, przepisywanie buforów w miejscu); nie zmieniaj liczby ani kolejności `Math.random`.
- Pierwszy strzał każdej broni nie może budować materiału (przestój) — grafy powstają przy `init`, nie przy spawnie.

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek.
- Harness `--backend webgpu --out .tmp/webgpu/zadania/12 --baza .tmp/webgpu/baseline/webgl/p1`: zero błędów walidacji;
  `bitwa`, `bitwa-blisko`, `wraki` — warstwa ortho bez zamienników Fx3D / smug / pocisków (`spis`), w tolerancji tam,
  gdzie warstwa jest czysta; draw calle passa ortho ~ baza; `coreRenderMs` bitwy nie gorszy niż przed zadaniem.
- `INWENTARZ.md`: pliki zadania bez GLSL; `POSTEP.md`; commit na `main`.

## Czego NIE robić
- Nie przenoś `SparkSystem3D` (17), efektów overlaya (17, 18), dysz (13 — iskry dysz MAIN pochodzą z Fx3D, więc ich
  wygląd przyjdzie z tym zadaniem).
- Nie zmieniaj rozgrywki broni, szyny strzałów (`WeaponShotBus`), wieżyczek 2D ani parametrów efektów.
- Nie wprowadzaj efektów z `dema/bronie-webgpu` bez decyzji użytkownika (PLAN §12 p. 6).

## Raport na koniec
Co zrobione; zrzuty `bitwa-blisko` i `bitwa__ortho` obok bazy; draw calle; czy pierwszy strzał powoduje przestój
(PerfHUD / `wyniki.json`); co zostało; pytania.
