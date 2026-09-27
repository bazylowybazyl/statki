# Zadanie 08 — Ring 3/5: struktura (ściany, dach, kadłub ringu) i atmosfera (chmury, powłoka powietrza)
Zależności: 07 | Równolegle z: 04, 05, 12–20 | Zalecany effort: xhigh
Zakres: `src/3d/haloRing/haloRingStructure.js` (564 linie: `HALO_GLSL_STRIP_VERTEX`, `HALO_GLSL_ROOF` 309,
`STRUCTURE_FRAGMENT` 221; materiał `HaloStructure`), `src/3d/haloRing/haloRingAtmosphere.js` (135: `HaloClouds`,
`HaloAirShell`; używa `STRIP_VERTEX`, `SURFACE`, `CLOUDCOVER`). ~700 linii, 3 materiały.

## Cel
Ściany i dach ringu (górna ściana w FG z wycięciem nad halą / zatoką i kołem nad statkiem, `K7RoofFade`), kadłub
ringu, chmury i powłoka powietrza jak w bazie.

## Przeczytaj najpierw
`agents.md` (Ring: BG warstwa 1, górna ściana w FG), `docs/PORT-halo-ring.md` (płaszczyzna gry na środku wstęgi,
wycięcie dachu, M3), `docs/webgpu/POSTEP.md`, `haloRingTSL.js`, `haloRingStructure.js`, `haloRingAtmosphere.js`,
test `haloRingRoofPlan`.

## Kroki
1. `HALO_GLSL_STRIP_VERTEX` i `HALO_GLSL_ROOF` → TSL (dach: hash bit w bit z `haloRingRoofPlan` — test).
2. Materiał struktury (BG i FG, `FG`/`FG_CLIP`, `setCutaway(0|1, …)` — uniformy), atmosfera (chmury, powłoka
   powietrza, przezroczystość, kolejność rysowania bez zmian).
3. Testy: `haloRingRoofPlan`, testy dema.

## Pułapki
- Wycięcie dachu zależy od uniformów ustawianych co klatkę z kamery TEJ klatki (`haloRings.update` przed `Core3D.render`)
  — nie przenoś obliczeń do innego miejsca w klatce.
- Przezroczyste `DoubleSide` → `forceSinglePass: true`.
- Warstwa FG (2) ma kamerę perspektywiczną — paralaksa ściany zostaje.

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek.
- Harness `--backend webgpu --out .tmp/webgpu/zadania/08 --baza .tmp/webgpu/baseline/webgl/p1`: zero błędów walidacji;
  `ring-z02__fg` (górna ściana), `k7-hala` (wycięcie), `ring-z02__tlo` (ściany, chmury) bez zamienników struktury i
  atmosfery; bez regresji względem 07.
- `halo_ring_demo` — presety z dachem i atmosferą (`--set mid`) porównane z bazą dema z tagu.
- `INWENTARZ.md`, `POSTEP.md`, commit na `main`.

## Czego NIE robić
- Nie przenoś megastruktury/miasta (09), K-7/archetypów (10); nie zmieniaj logiki wycięcia.

## Raport na koniec
Co zrobione; zrzuty `ring-z02__fg`, `k7-hala` obok bazy; co zostało; pytania.
