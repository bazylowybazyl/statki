# Zadanie 07 — Ring 2/5: teren (CDLOD) i zestaw przemysłowy
Zależności: 06 | Równolegle z: 04, 05, 12–20 | Zalecany effort: xhigh
Zakres: `src/3d/haloRing/haloRingTerrain.js` (601 linii GLSL: `TERRAIN_FRAGMENT` 447 + wierzchołki, materiał
`HaloTerrain`; `HALO_GLSL_SURFACE`/`CLOUDCOVER` przeszły do biblioteki w 06), `src/3d/haloRing/haloRingIndustryKit.js`
(`HALO_GLSL_INDKIT` 127 — używają go teren i miasto). ~650 linii, 1 materiał + biblioteka.

## Cel
Teren ringu (podłoga habitatu z LOD, strefy, porty, tranzyty, burze, noc/dzień, wycięcie nad statkiem) i zestaw
przemysłowy jak w bazie.

## Przeczytaj najpierw
`agents.md` (Ring), `docs/PORT-halo-ring.md` (M1–M5, strefy, tranzyty, Jakość/LOD), `docs/webgpu/PLAN.md` §3,
`docs/webgpu/POSTEP.md` (wyniki 06: biblioteka TSL, mapy), `src/3d/haloRing/haloRingTSL.js` (06),
`src/3d/haloRing/haloRingTerrain.js`, `haloRingIndustryKit.js`, test `haloRingRoofPlan` (bliźniak JS zestawu:
`indKitPart` / `indKitType`).

## Kroki
1. `HALO_GLSL_INDKIT` → funkcje TSL (bit w bit z bliźniakiem JS — test).
2. Materiał terenu: wierzchołki CDLOD (wysokość z mapy — tekstura z 06, morfing LOD), fragment 1:1 (strefy, detal
   `uDetailScale`, porty `PORTSITES`, tranzyty, burze `STORM`, światło `LIGHT`, powietrze `AIR`, wycięcie `FG_CLIP`).
   Gałęzie jakości (`HALO_LOD_*`) jako uniformy, nie `defines` w biegu (zmiana jakości = `ring.setQuality` z
   ponownym bake'iem — nowe materiały raz, dopuszczalne).
3. Warstwy: BG (1), górna ściana i elementy FG (2) bez zmian (`setLayers`).
4. Testy: `haloRingRoofPlan` (bliźniak zestawu i hash dachu), testy dema ringu.

## Pułapki
- Duży shader (447 linii): `Loop` zamiast rozwijania w JS; ciężkie funkcje z `setLayout` (SPIKE 10 — `mx_noise` ×160
  rozwinięte = 44 s kompilacji).
- `fwidth` w gałęziach — kompiluje się (USTALENIA §4), ale sprawdź aliasing linii.
- Tryb „Ultra” (dalszy LOD) — sprawdź obie jakości w demie (`quality=ultra`).
- Nie zmieniaj tekstur/map z 06 ani generatora.

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek.
- Harness `--backend webgpu --out .tmp/webgpu/zadania/07 --baza .tmp/webgpu/baseline/webgl/p1`: zero błędów walidacji;
  teren w `ring-z02__tlo`, `ring-z1`, `k7-hala__tlo` bez zamienników terenu, w tolerancji tam, gdzie warstwa jest
  czysta; bez regresji względem 06.
- `halo_ring_demo`: presety p1–p9 i ujęcia gry (`halo-ring-shots.mjs --set m4`) — teren bez zamienników; porównanie
  z bazą dema z tagu (worktree, `README.md`) w raporcie.
- `INWENTARZ.md`, `POSTEP.md`, commit na `main`.

## Czego NIE robić
- Nie przenoś struktury/atmosfery (08), megastruktury/miasta (09), K-7/archetypów (10).

## Raport na koniec
Co zrobione; zrzuty ringu (gra i demo) obok bazy; czas kompilacji materiału terenu; co zostało; pytania.
